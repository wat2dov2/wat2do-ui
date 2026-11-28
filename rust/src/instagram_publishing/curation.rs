//! Claude curates each school's daily carousel draft (`curation.py`); an
//! admin still reviews and publishes it.
//!
//! One Claude Code run per school reads that school's candidate packet and
//! posters from a private folder, then answers with its picks. The answer is
//! checked as a [`DraftSelection`] and saved with [`save_review_draft`]; a
//! refused answer is sent back once with the reason. Claude gets only Read
//! access to that folder and no application secrets.

use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use serde_json::{Map, Value, json};
use sqlx::PgPool;

use super::audit;
use super::drafts::{
    Candidate, NEEDS_REVIEW, Outcome, Packet, daily_batch, list_draft_candidates, local_date,
    save_review_draft,
};
use super::selection::{CAPTION_INTRO_LIMIT, DraftSelection, SelectionError};
use super::{Refused, error_message};
use crate::claude::{self, Agent};
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::prompts;
use crate::text::python_strip;

/// The curation agent's prompt in the local prompts folder ([`crate::prompts`]).
const PROMPT: &str = "instagram_publishing/curation_prompt.md";

/// Who and what Wat2Do promotes (`instagram_publishing/promotion_rules.md` in
/// the local prompts folder), shared with the ingestion agent's prompt, which
/// records each event's verdict as `events.promotable`; read as it is now.
pub fn promotion_rules() -> Result<String> {
    Ok(prompts::read("instagram_publishing/promotion_rules.md")?
        .trim_end()
        .to_owned())
}

/// The curation prompt with the promotion rules in place, as both are now.
fn prompt() -> Result<String> {
    Ok(prompts::fill(
        &prompts::read(PROMPT)?,
        &[("promotion_rules", promotion_rules()?)],
    ))
}
pub const WORKDIR_PREFIX: &str = "wat2do-instagram-curation-";

/// The structured answer Claude must give (`ANSWER_SCHEMA`).
pub fn answer_schema() -> Value {
    let control = &*INSTAGRAM_PUBLISHING;
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["picks", "cover_body", "caption_intro", "notes"],
        "properties": {
            "picks": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["event_id", "sticker_labels"],
                    "properties": {
                        "event_id": {"type": "integer"},
                        "sticker_labels": {
                            "type": "array",
                            "minItems": control.minimum_stickers_per_event,
                            "maxItems": control.maximum_stickers_per_event,
                            "items": {"type": "string"},
                        },
                    },
                },
            },
            "cover_body": {"type": "string", "maxLength": control.cover_body_character_limit},
            "caption_intro": {"type": "string", "maxLength": CAPTION_INTRO_LIMIT},
            "notes": {"type": "string"},
        },
    })
}

/// `curate_all`: draft every school that has no draft for today yet, a few
/// at a time, and count the outcomes.
pub async fn curate_all(db: &PgPool) -> Result<BTreeMap<String, i64>> {
    claude::remove_leftovers(WORKDIR_PREFIX);
    audit::remove_leftovers();
    let packets: Vec<Packet> = list_draft_candidates(db, chrono::Utc::now())
        .await?
        .into_iter()
        .filter(|packet| packet.status == NEEDS_REVIEW)
        .collect();
    let outcomes: Vec<&'static str> = futures_util::stream::iter(packets)
        .map(|packet| async move {
            match curate_school(db, &packet).await {
                Ok(outcome) => outcome.as_str(),
                Err(error) => {
                    tracing::error!(
                        "Instagram curation failed for {}: {error:#}",
                        packet.account_key
                    );
                    "failed"
                }
            }
        })
        .buffer_unordered(INSTAGRAM_PUBLISHING.curation_parallel_agents.max(1))
        .collect()
        .await;
    Ok(count(outcomes))
}

fn count(outcomes: Vec<&str>) -> BTreeMap<String, i64> {
    let mut counts = BTreeMap::new();
    for outcome in outcomes {
        *counts.entry(outcome.to_owned()).or_insert(0) += 1;
    }
    counts
}

/// `curate_school`: draft one school's carousel and return the save outcome.
pub async fn curate_school(db: &PgPool, packet: &Packet) -> Result<Outcome> {
    let open = packet
        .open
        .as_ref()
        .context("the school already has a draft today")?;
    let language = school_language(db, packet).await?;
    let save = async |answer: &Map<String, Value>| {
        save_answer(db, packet, language.as_str(), answer).await
    };
    if open.events.is_empty() {
        let empty = json!({"picks": [], "cover_body": "", "caption_intro": null});
        return save(empty.as_object().expect("an object")).await;
    }
    let workdir = tempfile::Builder::new()
        .prefix(WORKDIR_PREFIX)
        .tempdir()
        .context("could not make the curation folder")?;
    write_packet(workdir.path(), packet, language.clone()).await?;
    let ask = async |prompt: &str| run(prompt, workdir.path(), claude::claude_environment()).await;
    let outcome = answer_with_retries(ask, save).await?;
    if outcome == Outcome::Saved {
        audit_saved_draft(db, packet).await;
    }
    Ok(outcome)
}

/// Check the draft just saved against the promotion rules before a sitting
/// can post it; an audit that fails is logged and leaves the draft as saved.
async fn audit_saved_draft(db: &PgPool, packet: &Packet) {
    let day = local_date(packet.window_end);
    let audited = match daily_batch(db, &packet.account_key, day).await {
        Ok(Some((batch_id, _))) => audit::audit_draft(db, batch_id).await,
        Ok(None) => Ok(()),
        Err(error) => Err(error),
    };
    if let Err(error) = audited {
        tracing::error!(
            "Instagram draft audit failed for {}: {error:#}",
            packet.account_key
        );
    }
}

/// Ask, save, and ask again with the reason while an answer is refused, at
/// most `curation_attempts` times.
pub(super) async fn answer_with_retries(
    ask: impl AsyncFn(&str) -> Result<Map<String, Value>>,
    save: impl AsyncFn(&Map<String, Value>) -> Result<Outcome>,
) -> Result<Outcome> {
    let attempts = INSTAGRAM_PUBLISHING.curation_attempts;
    let template = prompt()?;
    let mut prompt = template.clone();
    for attempt in 1..=attempts {
        let answer = ask(&prompt).await?;
        match save(&answer).await {
            Ok(outcome) => return Ok(outcome),
            Err(error) if attempt < attempts && refused(&error) => {
                prompt = format!(
                    "{template}\n\nYour previous answer was rejected; fix this and answer again:\n{}",
                    error_message(&error)
                );
            }
            Err(error) => return Err(error),
        }
    }
    bail!("Instagram curation made no attempt")
}

/// Whether an answer was refused (Python's validation errors), not broken.
fn refused(error: &anyhow::Error) -> bool {
    error.downcast_ref::<Refused>().is_some() || error.downcast_ref::<SelectionError>().is_some()
}

/// `_save`: the answer as a draft; a blank caption intro keeps the packet's.
async fn save_answer(
    db: &PgPool,
    packet: &Packet,
    language: Option<&str>,
    answer: &Map<String, Value>,
) -> Result<Outcome> {
    let selection = selection_from_answer(packet, language, answer)?;
    let (outcome, _) = save_review_draft(db, &selection).await?;
    tracing::info!(
        "Instagram draft {}: {} ({})",
        packet.account_key,
        outcome.as_str(),
        answer
            .get("notes")
            .map(crate::pyjson::str)
            .unwrap_or("None".into())
    );
    Ok(outcome)
}

/// The answer as a selection, each pick short of `minimum_stickers_per_event`
/// first topped up from its event's own facts (see [`topped_up`]); `language`
/// is the school's, whose sticker list the agent was shown.
pub(super) fn selection_from_answer(
    packet: &Packet,
    language: Option<&str>,
    answer: &Map<String, Value>,
) -> Result<DraftSelection> {
    let open = packet.open.as_ref().context("no candidates")?;
    let caption_intro = answer
        .get("caption_intro")
        .and_then(Value::as_str)
        .filter(|intro| !intro.is_empty())
        .unwrap_or(&open.caption_intro);
    let cover_body = answer
        .get("cover_body")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("the answer has no cover_body"))?;
    let picks = topped_up(
        &open.events,
        sticker_labels(language),
        answer.get("picks").unwrap_or(&Value::Null),
    );
    let selection = DraftSelection::new(
        &packet.account_key,
        packet.window_end,
        python_strip(caption_intro),
        python_strip(cover_body),
        &picks,
    )?;
    if let Some(post) = overfeatured_post(&open.events, &selection) {
        return Err(Refused(format!(
            "More than {} picks come from the same Instagram post ({post}); \
             keep at most {} events from any one source_post",
            INSTAGRAM_PUBLISHING.maximum_slides_per_post,
            INSTAGRAM_PUBLISHING.maximum_slides_per_post,
        ))
        .into());
    }
    if let Some(label) = unlisted_sticker(&selection) {
        return Err(Refused(format!(
            "Sticker \"{label}\" is not in packet.json's sticker_labels; \
             copy sticker labels exactly from that list"
        ))
        .into());
    }
    Ok(selection)
}

/// The fixed sticker list for a school language; English when it has none.
fn sticker_labels(language: Option<&str>) -> &'static [String] {
    let labels = &INSTAGRAM_PUBLISHING.sticker_labels;
    language
        .and_then(|language| labels.get(language))
        .or_else(|| labels.get("en"))
        .map_or(&[], Vec::as_slice)
}

/// A sticker label an event's own facts prove, in English and French, with
/// the labels that already say the same thing.
struct FactLabel {
    en: &'static str,
    fr: &'static str,
    alike: &'static [&'static str],
}

impl FactLabel {
    /// Whether `label` already says this.
    fn said_by(&self, label: &str) -> bool {
        label == self.en || label == self.fr || self.alike.contains(&label)
    }
}

const FREE_ENTRY: FactLabel = FactLabel {
    en: "Free Entry",
    fr: "Entrée Gratuite",
    alike: &["Paid Entry", "Entrée Payante"],
};
const PAID_ENTRY: FactLabel = FactLabel {
    en: "Paid Entry",
    fr: "Entrée Payante",
    alike: &["Free Entry", "Entrée Gratuite"],
};
const FREE_PIZZA: FactLabel = FactLabel {
    en: "Free Pizza",
    fr: "Pizza Gratuite",
    alike: &["Free Food", "Nourriture Gratuite"],
};
const FREE_FOOD: FactLabel = FactLabel {
    en: "Free Food",
    fr: "Nourriture Gratuite",
    alike: &[
        "Free Pizza",
        "Pizza Gratuite",
        "Free Snacks",
        "Collations Gratuites",
    ],
};
const REGISTRATION: FactLabel = FactLabel {
    en: "Reg. Required",
    fr: "Inscription Requise",
    alike: &["Limited Spots", "Places Limitées"],
};

/// The labels `event`'s price, food and registration prove, in that order.
fn fact_labels(event: &Candidate) -> Vec<&'static FactLabel> {
    let mut labels = Vec::new();
    match event.price.as_ref().and_then(Value::as_f64) {
        Some(price) if price <= 0.0 => labels.push(&FREE_ENTRY),
        Some(_) => labels.push(&PAID_ENTRY),
        None => {}
    }
    let food: Vec<String> = match &event.food {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_str)
            .map(crate::text::casefold)
            .collect(),
        Some(Value::String(item)) => vec![crate::text::casefold(item)],
        _ => Vec::new(),
    };
    if food.iter().any(|item| item.contains("pizza")) {
        labels.push(&FREE_PIZZA);
    } else if !food.is_empty() {
        labels.push(&FREE_FOOD);
    }
    if event.registration {
        labels.push(&REGISTRATION);
    }
    labels
}

/// The picks, each one short of `minimum_stickers_per_event` topped up with
/// labels its event's facts prove (from `stickers`, the school's list) that
/// say something its labels do not; a pick still short is left to be refused.
fn topped_up(events: &[Candidate], stickers: &[String], picks: &Value) -> Value {
    let minimum = INSTAGRAM_PUBLISHING.minimum_stickers_per_event;
    let Value::Array(picks) = picks else {
        return picks.clone();
    };
    let topped = picks.iter().map(|pick| {
        let mut pick = pick.clone();
        let event_id = pick.get("event_id").and_then(Value::as_i64);
        let event = events.iter().find(|event| Some(event.id) == event_id);
        let (Some(event), Some(Value::Array(labels))) = (event, pick.get_mut("sticker_labels"))
        else {
            return pick;
        };
        for fact in fact_labels(event) {
            if labels.len() >= minimum {
                break;
            }
            let said = labels
                .iter()
                .filter_map(Value::as_str)
                .any(|label| fact.said_by(label));
            let listed = [fact.en, fact.fr]
                .into_iter()
                .find(|name| stickers.iter().any(|listed| listed == name));
            if let (false, Some(label)) = (said, listed) {
                labels.push(label.into());
            }
        }
        pick
    });
    Value::Array(topped.collect())
}

/// A picked sticker label outside every language's fixed list.
fn unlisted_sticker(selection: &DraftSelection) -> Option<&str> {
    let lists = &INSTAGRAM_PUBLISHING.sticker_labels;
    selection
        .picks
        .iter()
        .flat_map(|pick| &pick.sticker_labels)
        .find(|label| !lists.values().flatten().any(|listed| listed == *label))
        .map(String::as_str)
}

/// A post more than `maximum_slides_per_post` of the picks were read from:
/// a club's one post listing a week of events would fill the carousel.
fn overfeatured_post<'a>(events: &'a [Candidate], selection: &DraftSelection) -> Option<&'a str> {
    let mut picked: BTreeMap<&str, usize> = BTreeMap::new();
    for pick in &selection.picks {
        let post = events
            .iter()
            .find(|event| event.id == pick.event_id)
            .and_then(|event| event.source_url.as_deref());
        if let Some(post) = post {
            *picked.entry(post).or_default() += 1;
        }
    }
    picked
        .into_iter()
        .find(|(_, count)| *count > INSTAGRAM_PUBLISHING.maximum_slides_per_post)
        .map(|(post, _)| post)
}

/// The school's language as `packet.json` gives it: its own (null when it has
/// none), or `en` for a school that is not registered.
async fn school_language(db: &PgPool, packet: &Packet) -> Result<Value> {
    let language: Option<Option<String>> =
        sqlx::query_scalar("SELECT language FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(crate::schools::normalize_slug(&packet.account_key))
            .fetch_optional(db)
            .await?;
    Ok(match language {
        Some(language) => language.map_or(Value::Null, Value::from),
        None => "en".into(),
    })
}

/// `_write_packet`: `packet.json` and the posters, for the agent to read.
async fn write_packet(workdir: &Path, packet: &Packet, language: Value) -> Result<()> {
    let open = packet.open.as_ref().context("no candidates")?;
    let posters = workdir.join("posters");
    std::fs::create_dir(&posters)?;
    let mut poster_files = Vec::new();
    for event in &open.events {
        poster_files
            .push(download_poster(event.source_image_url.as_deref(), &posters, event.id).await);
    }
    std::fs::write(
        workdir.join("packet.json"),
        packet_document(packet, language, &poster_files)?,
    )?;
    Ok(())
}

/// `packet.json`'s text: the school, its language, the default intro, the
/// slide count, each event with its poster file, and the excluded clubs.
pub(super) fn packet_document(
    packet: &Packet,
    language: Value,
    poster_files: &[Option<String>],
) -> Result<String> {
    let open = packet.open.as_ref().context("no candidates")?;
    let events: Vec<Value> = open
        .events
        .iter()
        .zip(poster_files)
        .map(|(event, poster)| {
            let mut summary = event.packet_summary();
            summary.insert(
                "poster_file".into(),
                poster.clone().map_or(Value::Null, Value::from),
            );
            Value::Object(summary)
        })
        .collect();
    let stickers = sticker_labels(language.as_str());
    let content = json!({
        "school": packet.account_key,
        "language": language,
        "default_caption_intro": open.caption_intro,
        "event_slides": INSTAGRAM_PUBLISHING.maximum_event_slides,
        "sticker_labels": stickers,
        "events": events,
        "excluded_clubs": open.excluded_clubs,
    });
    Ok(crate::pyjson::dumps_unicode(&content, Some(1)))
}

/// `_download_poster`: a small JPEG of the poster for Claude to look at, as
/// its path in the folder; `None` when there is none or it cannot be read.
async fn download_poster(url: Option<&str>, folder: &Path, event_id: i64) -> Option<String> {
    let url = url.filter(|url| url.starts_with("http"))?;
    let name = format!("{event_id}.jpg");
    match fetch_and_shrink(url, folder, event_id, &folder.join(&name)).await {
        Ok(()) => Some(format!("posters/{name}")),
        Err(error) => {
            tracing::warn!("Poster unavailable for event {event_id}: {error:#}");
            None
        }
    }
}

async fn fetch_and_shrink(url: &str, folder: &Path, event_id: i64, path: &Path) -> Result<()> {
    let timeout = Duration::from_secs_f64(INSTAGRAM_PUBLISHING.poster_timeout_seconds);
    let client = wreq::Client::builder()
        .timeout(timeout)
        // httpx's follow_redirects=True follows at most 20.
        .redirect(wreq::redirect::Policy::limited(20))
        .build()?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| anyhow!("{}", error.without_uri()))?;
    if !response.status().is_success() {
        bail!("HTTP {}", response.status().as_u16());
    }
    let source = folder.join(format!("{event_id}.source"));
    std::fs::write(&source, response.bytes().await?)?;
    let pixels = INSTAGRAM_PUBLISHING.curation_poster_pixels.to_string();
    let output = tokio::process::Command::new("sips")
        .args(["-s", "format", "jpeg", "-Z", &pixels])
        .arg(&source)
        .arg("--out")
        .arg(path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .status();
    let status = tokio::time::timeout(timeout, output)
        .await
        .map_err(|_| anyhow!("sips timed out"))??;
    if !status.success() {
        bail!("sips failed ({status})");
    }
    std::fs::remove_file(&source)?;
    Ok(())
}

/// `_run`: one agent with Read access to the folder only, on the login
/// `env` names.
pub(super) async fn run(
    prompt: &str,
    workdir: &Path,
    env: std::collections::HashMap<String, String>,
) -> Result<Map<String, Value>> {
    let control = &*INSTAGRAM_PUBLISHING;
    let schema = answer_schema();
    claude::run_agent(
        prompt,
        workdir,
        Agent {
            name: "Instagram curation agent",
            model: &control.curation_model,
            tools: &["Read"],
            allowed_tools: &["Read(./**)"],
            schema: &schema,
            timeout: Duration::from_secs_f64(control.curation_timeout_seconds),
            env,
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::instagram_publishing::drafts::OpenPacket;

    fn packet() -> Packet {
        let now = "2026-10-12T13:00:00Z".parse().unwrap();
        Packet {
            account_key: "uwaterloo".into(),
            publishing_connected: true,
            requires_reauthorization: false,
            local_date: crate::instagram_publishing::drafts::local_date(now),
            window_end: now,
            batch_id: None,
            status: NEEDS_REVIEW.into(),
            open: Some(OpenPacket {
                window_start: now,
                caption_intro: "Fresh events at uwaterloo".into(),
                events: Vec::new(),
                excluded_clubs: Vec::new(),
            }),
        }
    }

    fn answer(labels: &[&str]) -> Map<String, Value> {
        json!({
            "picks": [{"event_id": 17, "sticker_labels": labels}],
            "cover_body": " Pizza Night with free slices. ",
            "caption_intro": "",
            "notes": "",
        })
        .as_object()
        .unwrap()
        .clone()
    }

    #[test]
    fn a_blank_intro_keeps_the_packets_and_copy_is_trimmed() {
        // test_answer_is_saved
        let selection =
            selection_from_answer(&packet(), None, &answer(&["Free Pizza", "Games"])).unwrap();
        assert_eq!(selection.picks[0].event_id, 17);
        assert_eq!(selection.caption_intro, "Fresh events at uwaterloo");
        assert_eq!(selection.cover_body, "Pizza Night with free slices.");
        let refused =
            selection_from_answer(&packet(), None, &answer(&["free pizza", "Games"])).unwrap_err();
        assert!(refused.downcast_ref::<SelectionError>().is_some());
    }

    #[test]
    fn at_most_two_picks_come_from_one_post() {
        let limit = INSTAGRAM_PUBLISHING.maximum_slides_per_post;
        let mut packet = packet();
        let open = packet.open.as_mut().unwrap();
        for id in 1..=(limit as i64 + 2) {
            let mut event = candidate(id);
            event.source_url = Some(if id == limit as i64 + 2 {
                "https://www.instagram.com/p/OTHER/".into()
            } else {
                "https://www.instagram.com/p/WEEK/".into()
            });
            open.events.push(event);
        }
        let answer_for = |ids: Vec<i64>| {
            json!({
                "picks": ids.iter().map(|id| json!({"event_id": id, "sticker_labels": ["Free Pizza", "Games"]})).collect::<Vec<_>>(),
                "cover_body": "A week of rallies",
                "caption_intro": "",
            })
            .as_object()
            .unwrap()
            .clone()
        };
        let within: Vec<i64> = (1..=limit as i64).chain([limit as i64 + 2]).collect();
        assert!(selection_from_answer(&packet, None, &answer_for(within)).is_ok());
        let over =
            selection_from_answer(&packet, None, &answer_for((1..=limit as i64 + 1).collect()))
                .unwrap_err();
        let refusal = over.downcast_ref::<Refused>().unwrap();
        assert!(refusal.0.contains("https://www.instagram.com/p/WEEK/"));
        // The agent is shown it and asked again.
        assert!(refused(&over));
    }

    /// Saves the way `save_answer` checks an answer, without a database.
    async fn check(answer: &Map<String, Value>) -> Result<Outcome> {
        selection_from_answer(&packet(), None, answer)?;
        Ok(Outcome::Saved)
    }

    #[tokio::test]
    async fn a_refused_answer_is_asked_again_with_the_reason() {
        // test_rejected_answer_is_retried_with_the_reason
        let prompts = Mutex::new(Vec::new());
        let answers = Mutex::new(vec![
            answer(&["Free Pizza", "Games"]),
            answer(&["free pizza", "Games"]),
        ]);
        let ask = async |prompt: &str| {
            prompts.lock().unwrap().push(prompt.to_owned());
            Ok(answers.lock().unwrap().pop().unwrap())
        };
        assert_eq!(
            answer_with_retries(ask, check).await.unwrap(),
            Outcome::Saved
        );
        let prompts = prompts.into_inner().unwrap();
        let template = prompt().unwrap();
        assert_eq!(prompts[0], template);
        assert!(prompts[1].starts_with(&template));
        assert!(prompts[1].contains(
            "Your previous answer was rejected; fix this and answer again:\n1 validation error"
        ));
        assert!(prompts[1].contains("Sticker words must start with capital letters"));
    }

    #[tokio::test]
    async fn repeated_refusals_fail_without_saving() {
        // test_repeated_rejection_fails_without_saving
        let saved = Mutex::new(0);
        let ask = async |_: &str| Ok(answer(&["free pizza", "Games"]));
        let save = async |answer: &Map<String, Value>| {
            let outcome = check(answer).await?;
            *saved.lock().unwrap() += 1;
            Ok(outcome)
        };
        assert!(answer_with_retries(ask, save).await.is_err());
        assert_eq!(*saved.lock().unwrap(), 0);
        // A broken agent run is not asked again.
        let calls = Mutex::new(0);
        let broken = async |_: &str| {
            *calls.lock().unwrap() += 1;
            Err(anyhow!("Instagram curation agent failed (exit 1)"))
        };
        assert!(answer_with_retries(broken, check).await.is_err());
        assert_eq!(*calls.lock().unwrap(), 1);
    }

    fn candidate(id: i64) -> Candidate {
        Candidate {
            id,
            title: format!("Event {id}"),
            description: None,
            location: Some("SLC".into()),
            club: Some("Club".into()),
            ig_handle: None,
            source_image_url: Some(format!("https://media.test/{id}.jpg")),
            category: Some("Health".into()),
            employers_on_campus: None,
            price: None,
            food: None,
            registration: false,
            carousel_requested_at: None,
            source_url: None,
            dtstart_utc: "2026-10-14T23:00:00Z".parse().unwrap(),
            dtend_utc: None,
            tz: "America/Toronto".into(),
        }
    }

    #[test]
    fn the_packet_gives_each_event_its_poster_file() {
        let mut packet = packet();
        packet.open.as_mut().unwrap().events = vec![candidate(17), candidate(9)];
        let text =
            packet_document(&packet, "fr".into(), &[Some("posters/17.jpg".into()), None]).unwrap();
        let document: Value = serde_json::from_str(&text).unwrap();
        let events = document["events"].as_array().unwrap();
        assert_eq!(
            events
                .iter()
                .map(|event| event["id"].clone())
                .collect::<Vec<_>>(),
            [json!(17), json!(9)]
        );
        assert_eq!(events[0]["poster_file"], "posters/17.jpg");
        assert_eq!(events[1]["poster_file"], Value::Null);
        assert_eq!(document["language"], "fr");
        assert_eq!(document["sticker_labels"][0], "Entrée Gratuite");
        // As Python wrote it: one-space indent, the poster last.
        assert!(text.contains(
            "\n   \"carousel_requested_at\": null,\n   \"source_post\": null,\n   \"poster_file\": \"posters/17.jpg\"\n"
        ));
        assert!(text.contains(
            "\n   \"carousel_requested_at\": null,\n   \"source_post\": null,\n   \"poster_file\": null\n"
        ));
    }

    #[test]
    fn stickers_come_only_from_the_fixed_list() {
        assert!(
            selection_from_answer(&packet(), None, &answer(&["Free Pizza", "Reg. Required"]))
                .is_ok()
        );
        let refused =
            selection_from_answer(&packet(), None, &answer(&["Free Pizza", "Cozy Vibes"]))
                .unwrap_err();
        assert!(refused.to_string().contains("\"Cozy Vibes\" is not in"));
        assert_eq!(sticker_labels(None)[0], "Free Entry");
        for labels in INSTAGRAM_PUBLISHING.sticker_labels.values() {
            assert_eq!(
                crate::instagram_publishing::selection::validate_labels(labels)
                    .as_deref()
                    .ok(),
                Some(labels.as_slice())
            );
        }
    }

    #[test]
    fn a_lone_sticker_is_topped_up_from_the_events_facts() {
        let mut packet = packet();
        let mut event = candidate(17);
        event.price = Some(json!(0));
        event.food = Some(json!(["Pizza", "pop"]));
        event.registration = true;
        packet.open.as_mut().unwrap().events = vec![event];
        // The price says something new; one more label reaches the minimum.
        let selection = selection_from_answer(&packet, None, &answer(&["Games"])).unwrap();
        assert_eq!(selection.picks[0].sticker_labels, ["Games", "Free Entry"]);
        // A label already saying the price or the food is never repeated.
        let selection = selection_from_answer(&packet, None, &answer(&["Paid Entry"])).unwrap();
        assert_eq!(
            selection.picks[0].sticker_labels,
            ["Paid Entry", "Free Pizza"]
        );
        let selection = selection_from_answer(&packet, None, &answer(&["Free Food"])).unwrap();
        assert_eq!(
            selection.picks[0].sticker_labels,
            ["Free Food", "Free Entry"]
        );
        // In the school's language.
        let selection = selection_from_answer(&packet, Some("fr"), &answer(&["Jeux"])).unwrap();
        assert_eq!(
            selection.picks[0].sticker_labels,
            ["Jeux", "Entrée Gratuite"]
        );
        // Labels already at the minimum are left as the agent chose them.
        let selection =
            selection_from_answer(&packet, None, &answer(&["Games", "Prizes"])).unwrap();
        assert_eq!(selection.picks[0].sticker_labels, ["Games", "Prizes"]);
    }

    #[test]
    fn a_lone_sticker_the_facts_cannot_top_up_is_refused() {
        let mut packet = packet();
        packet.open.as_mut().unwrap().events = vec![candidate(17)];
        let refused = selection_from_answer(&packet, None, &answer(&["Games"])).unwrap_err();
        assert!(refused.downcast_ref::<SelectionError>().is_some());
        assert!(
            refused
                .to_string()
                .contains("List should have at least 2 items after validation, not 1")
        );
    }

    #[test]
    fn every_fact_label_is_on_its_languages_list() {
        for fact in [
            &FREE_ENTRY,
            &PAID_ENTRY,
            &FREE_PIZZA,
            &FREE_FOOD,
            &REGISTRATION,
        ] {
            assert!(
                sticker_labels(Some("en"))
                    .iter()
                    .any(|label| label == fact.en)
            );
            assert!(
                sticker_labels(Some("fr"))
                    .iter()
                    .any(|label| label == fact.fr)
            );
        }
    }

    #[test]
    fn outcomes_are_counted_by_name() {
        // test_curate_all_counts_outcomes_and_skips_existing_drafts
        assert_eq!(
            count(vec!["saved", "failed", "saved"]),
            BTreeMap::from([("failed".into(), 1), ("saved".into(), 2)])
        );
    }

    #[test]
    fn the_schema_holds_the_control_box_limits() {
        let schema = answer_schema();
        assert_eq!(schema["properties"]["cover_body"]["maxLength"], 120);
        assert_eq!(
            schema["properties"]["picks"]["items"]["properties"]["sticker_labels"]["maxItems"],
            4
        );
        assert_eq!(
            schema["properties"]["picks"]["items"]["properties"]["sticker_labels"]["minItems"],
            2
        );
    }

    #[test]
    fn the_prompt_carries_the_promotion_rules() {
        let prompt = prompt().unwrap();
        assert!(!prompt.contains("{{"));
        assert!(prompt.contains(&format!("promotion_rules: {}", promotion_rules().unwrap())));
    }
}
