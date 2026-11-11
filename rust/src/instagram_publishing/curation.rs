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

use super::drafts::{NEEDS_REVIEW, Outcome, Packet, list_draft_candidates, save_review_draft};
use super::selection::{CAPTION_INTRO_LIMIT, DraftSelection, SelectionError};
use super::{Refused, error_message};
use crate::claude::{self, Agent};
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::text::python_strip;

pub const PROMPT: &str = include_str!("curation_prompt.md");
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
                            "minItems": 1,
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
    let save = async |answer: &Map<String, Value>| save_answer(db, packet, answer).await;
    if open.events.is_empty() {
        let empty = json!({"picks": [], "cover_body": "", "caption_intro": null});
        return save(empty.as_object().expect("an object")).await;
    }
    let workdir = tempfile::Builder::new()
        .prefix(WORKDIR_PREFIX)
        .tempdir()
        .context("could not make the curation folder")?;
    write_packet(db, workdir.path(), packet).await?;
    let ask = async |prompt: &str| run(prompt, workdir.path()).await;
    answer_with_retries(ask, save).await
}

/// Ask, save, and ask again with the reason while an answer is refused, at
/// most `curation_attempts` times.
async fn answer_with_retries(
    ask: impl AsyncFn(&str) -> Result<Map<String, Value>>,
    save: impl AsyncFn(&Map<String, Value>) -> Result<Outcome>,
) -> Result<Outcome> {
    let attempts = INSTAGRAM_PUBLISHING.curation_attempts;
    let mut prompt = PROMPT.to_owned();
    for attempt in 1..=attempts {
        let answer = ask(&prompt).await?;
        match save(&answer).await {
            Ok(outcome) => return Ok(outcome),
            Err(error) if attempt < attempts && refused(&error) => {
                prompt = format!(
                    "{PROMPT}\n\nYour previous answer was rejected; fix this and answer again:\n{}",
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
async fn save_answer(db: &PgPool, packet: &Packet, answer: &Map<String, Value>) -> Result<Outcome> {
    let selection = selection_from_answer(packet, answer)?;
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

fn selection_from_answer(packet: &Packet, answer: &Map<String, Value>) -> Result<DraftSelection> {
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
    let picks = answer.get("picks").unwrap_or(&Value::Null);
    Ok(DraftSelection::new(
        &packet.account_key,
        packet.window_end,
        python_strip(caption_intro),
        python_strip(cover_body),
        picks,
    )?)
}

/// `_write_packet`: `packet.json` and the posters, for the agent to read.
async fn write_packet(db: &PgPool, workdir: &Path, packet: &Packet) -> Result<()> {
    let open = packet.open.as_ref().context("no candidates")?;
    let posters = workdir.join("posters");
    std::fs::create_dir(&posters)?;
    let mut poster_files = Vec::new();
    for event in &open.events {
        poster_files
            .push(download_poster(event.source_image_url.as_deref(), &posters, event.id).await);
    }
    let language: Option<Option<String>> =
        sqlx::query_scalar("SELECT language FROM public.schools WHERE slug = $1 LIMIT 1")
            .bind(crate::schools::normalize_slug(&packet.account_key))
            .fetch_optional(db)
            .await?;
    let language = match language {
        Some(language) => language.map_or(Value::Null, Value::from),
        None => "en".into(),
    };
    std::fs::write(
        workdir.join("packet.json"),
        packet_document(packet, language, &poster_files)?,
    )?;
    Ok(())
}

/// `packet.json`'s text: the school, its language, the default intro, the
/// slide count, each event with its poster file, and the excluded clubs.
fn packet_document(
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
    let content = json!({
        "school": packet.account_key,
        "language": language,
        "default_caption_intro": open.caption_intro,
        "event_slides": INSTAGRAM_PUBLISHING.maximum_event_slides,
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

/// `_run`: one agent with Read access to the folder only.
async fn run(prompt: &str, workdir: &Path) -> Result<Map<String, Value>> {
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
            env: claude::claude_environment(),
        },
    )
    .await
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::instagram_publishing::drafts::{Candidate, OpenPacket};

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
        let selection = selection_from_answer(&packet(), &answer(&["Free Pizza"])).unwrap();
        assert_eq!(selection.picks[0].event_id, 17);
        assert_eq!(selection.caption_intro, "Fresh events at uwaterloo");
        assert_eq!(selection.cover_body, "Pizza Night with free slices.");
        let refused = selection_from_answer(&packet(), &answer(&["free pizza"])).unwrap_err();
        assert!(refused.downcast_ref::<SelectionError>().is_some());
    }

    /// Saves the way `save_answer` checks an answer, without a database.
    async fn check(answer: &Map<String, Value>) -> Result<Outcome> {
        selection_from_answer(&packet(), answer)?;
        Ok(Outcome::Saved)
    }

    #[tokio::test]
    async fn a_refused_answer_is_asked_again_with_the_reason() {
        // test_rejected_answer_is_retried_with_the_reason
        let prompts = Mutex::new(Vec::new());
        let answers = Mutex::new(vec![answer(&["Free Pizza"]), answer(&["free pizza"])]);
        let ask = async |prompt: &str| {
            prompts.lock().unwrap().push(prompt.to_owned());
            Ok(answers.lock().unwrap().pop().unwrap())
        };
        assert_eq!(
            answer_with_retries(ask, check).await.unwrap(),
            Outcome::Saved
        );
        let prompts = prompts.into_inner().unwrap();
        assert_eq!(prompts[0], PROMPT);
        assert!(prompts[1].starts_with(PROMPT));
        assert!(prompts[1].contains(
            "Your previous answer was rejected; fix this and answer again:\n1 validation error"
        ));
        assert!(prompts[1].contains("Sticker words must start with capital letters"));
    }

    #[tokio::test]
    async fn repeated_refusals_fail_without_saving() {
        // test_repeated_rejection_fails_without_saving
        let saved = Mutex::new(0);
        let ask = async |_: &str| Ok(answer(&["free pizza"]));
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
        // As Python wrote it: one-space indent, the poster last.
        assert!(text.contains(
            "\n   \"carousel_requested_at\": null,\n   \"poster_file\": \"posters/17.jpg\"\n"
        ));
        assert!(text.contains("\n   \"carousel_requested_at\": null,\n   \"poster_file\": null\n"));
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
        assert!(PROMPT.starts_with("You curate today's wat2do Instagram carousel draft"));
    }
}
