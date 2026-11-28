//! The draft audit: right after curation saves a school's draft, a second
//! agent, on the quality login, checks every slide against the promotion rules
//! (`promotion_rules.md`, plus no religion or politics). A slide that fails
//! them leaves the draft through the admin editor's own save
//! ([`batches::update_batch`]) before a sitting can post it, and its event is
//! marked not promotable. A slide whose place or start time is still to be
//! announced ([`details::pending_detail`]) leaves too, whatever the agent says,
//! but its event stays promotable for when the club names them. Every audit is
//! logged to `draft-audits.jsonl` in the carousel state folder, so what left
//! which draft, and why, can be read back.

use std::collections::HashMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result, bail};
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

use super::curation::promotion_rules;
use super::details;
use super::drafts::Candidate;
use super::job_error;
use crate::api::events::model::Event;
use crate::api::events::store;
use crate::api::routes::instagram_publishing::batches::{
    self, DraftUpdate, STATUS_READY_FOR_REVIEW,
};
use crate::claude::{self, Agent};
use crate::controlbox::INSTAGRAM_PUBLISHING;
use crate::prompts;

/// The audit agent's prompt in the local prompts folder ([`crate::prompts`]).
const PROMPT: &str = "instagram_publishing/draft_audit_prompt.md";

/// The audit prompt with the promotion rules in place, as both are now.
fn prompt() -> Result<String> {
    Ok(prompts::fill(
        &prompts::read(PROMPT)?,
        &[("promotion_rules", promotion_rules()?)],
    ))
}
pub const WORKDIR_PREFIX: &str = "wat2do-instagram-draft-audit-";

/// Delete the folders interrupted audits left. Only a job's start may do it:
/// judges run in parallel, and each one's folder must outlive its run.
pub fn remove_leftovers() {
    claude::remove_leftovers(WORKDIR_PREFIX);
}

/// What the audit agent reads about one slide's event.
#[derive(Debug, Clone)]
pub struct Slide {
    pub id: i64,
    pub title: String,
    pub club: Option<String>,
    pub category: Option<String>,
    pub description: Option<String>,
    pub location: Option<String>,
    pub price: Value,
    /// Why its place or start time is still to be announced, if it is: the
    /// slide leaves the draft whatever the agent says.
    pub pending: Option<&'static str>,
}

impl Slide {
    /// A draft's slide, its start time read in the school's `zone` as the
    /// slide prints it (the event's first occurrence).
    fn from_event(event: &Event, zone: &str) -> Self {
        let pending = event.occurrences.first().and_then(|occurrence| {
            details::pending_detail(
                &event.title,
                event.description.as_deref(),
                event.location.as_deref(),
                occurrence.dtstart_utc,
                zone,
            )
        });
        Self {
            id: event.id,
            title: event.title.clone(),
            club: event.club.clone(),
            category: event.category.clone(),
            description: event.description.clone(),
            location: event.location.clone(),
            price: event.price.map_or(Value::Null, Value::from),
            pending,
        }
    }
}

impl From<&Candidate> for Slide {
    fn from(event: &Candidate) -> Self {
        Self {
            id: event.id,
            title: event.title.clone(),
            club: event.club.clone(),
            category: event.category.clone(),
            description: event.description.clone(),
            location: event.location.clone(),
            price: event.price.clone().unwrap_or(Value::Null),
            pending: event.pending_detail(),
        }
    }
}

impl Slide {
    fn to_json(&self) -> Value {
        json!({
            "event_id": self.id,
            "title": self.title,
            "club": self.club,
            "category": self.category,
            "description": self.description,
            "location": self.location,
            "price": self.price,
            "pending_detail": self.pending,
        })
    }
}

/// The agent's verdict on one slide.
#[derive(Debug, Clone, Deserialize, PartialEq)]
pub struct Verdict {
    pub event_id: i64,
    pub promotable: bool,
    pub reason: String,
}

/// The agent's answer: a verdict per slide, and the cover sentence to keep.
#[derive(Debug, Clone, Deserialize)]
pub struct Judgement {
    pub verdicts: Vec<Verdict>,
    pub cover_body: String,
}

impl Judgement {
    pub fn failing(&self) -> Vec<&Verdict> {
        self.verdicts
            .iter()
            .filter(|verdict| !verdict.promotable)
            .collect()
    }

    /// Code has the last word on details still to be announced: such a slide
    /// fails, with that reason, whatever the agent said.
    fn fail_pending(&mut self, slides: &[Slide]) {
        for verdict in &mut self.verdicts {
            let pending = slides
                .iter()
                .find(|slide| slide.id == verdict.event_id)
                .and_then(|slide| slide.pending);
            if let Some(pending) = pending {
                verdict.promotable = false;
                verdict.reason = pending.to_owned();
            }
        }
    }
}

/// The structured answer the audit agent must give.
pub fn answer_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["verdicts", "cover_body"],
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["event_id", "promotable", "reason"],
                    "properties": {
                        "event_id": {"type": "integer"},
                        "promotable": {"type": "boolean"},
                        "reason": {"type": "string"},
                    },
                },
            },
            "cover_body": {"type": "string"},
        },
    })
}

/// The quality login's environment: what Claude Code itself needs, plus
/// `quality_claude_config_dir`, so these runs never spend ingestion's login.
pub fn quality_environment() -> HashMap<String, String> {
    let mut env = claude::claude_environment();
    let dir = &INSTAGRAM_PUBLISHING.quality_claude_config_dir;
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = dir
        .strip_prefix("~/")
        .map_or_else(|| dir.clone(), |rest| format!("{home}/{rest}"));
    env.insert("CLAUDE_CONFIG_DIR".into(), dir);
    env
}

/// Have the audit agent judge `slides`, a draft of `school` whose cover reads
/// `cover_body`; every slide gets exactly one verdict.
pub async fn judge(school: &str, cover_body: &str, slides: &[Slide]) -> Result<Judgement> {
    let workdir = tempfile::Builder::new()
        .prefix(WORKDIR_PREFIX)
        .tempdir()
        .context("could not make the draft audit folder")?;
    let draft = json!({
        "school": school,
        "cover_body": cover_body,
        "events": slides.iter().map(Slide::to_json).collect::<Vec<_>>(),
    });
    std::fs::write(
        workdir.path().join("draft.json"),
        crate::pyjson::dumps_unicode(&draft, Some(1)),
    )?;
    let schema = answer_schema();
    let answer = claude::run_agent(
        &prompt()?,
        workdir.path(),
        Agent {
            name: "Instagram draft audit agent",
            model: &INSTAGRAM_PUBLISHING.draft_audit_model,
            tools: &["Read"],
            allowed_tools: &["Read(./**)"],
            schema: &schema,
            timeout: Duration::from_secs_f64(INSTAGRAM_PUBLISHING.draft_audit_timeout_seconds),
            env: quality_environment(),
        },
    )
    .await?;
    let mut judgement: Judgement = serde_json::from_value(Value::Object(answer))?;
    check_verdicts(&judgement, slides)?;
    judgement.fail_pending(slides);
    Ok(judgement)
}

/// Exactly one verdict per slide, and none for anything else.
fn check_verdicts(judgement: &Judgement, slides: &[Slide]) -> Result<()> {
    let mut judged: Vec<i64> = judgement.verdicts.iter().map(|v| v.event_id).collect();
    let mut expected: Vec<i64> = slides.iter().map(|slide| slide.id).collect();
    judged.sort_unstable();
    expected.sort_unstable();
    if judged != expected {
        bail!("the draft audit judged events {judged:?}, not the slides {expected:?}");
    }
    Ok(())
}

/// The cover to keep: the agent's when it is a valid cover, else the draft's.
fn kept_cover(judgement: &Judgement, draft_cover: &str) -> String {
    let cover = judgement.cover_body.trim();
    if cover.chars().count() <= INSTAGRAM_PUBLISHING.cover_body_character_limit {
        cover.to_owned()
    } else {
        draft_cover.to_owned()
    }
}

/// Audit one saved draft: take off its slides that fail the rules, mark those
/// events not promotable, and log what happened. A failed audit is logged and
/// leaves the draft as curation saved it.
pub async fn audit_draft(db: &PgPool, batch_id: Uuid) -> Result<()> {
    let batch = batches::get_batch(db, batch_id).await.map_err(job_error)?;
    if batch.row.status != STATUS_READY_FOR_REVIEW {
        return Ok(());
    }
    let zone = store::school_timezone(db, Some(&batch.row.school))
        .await
        .map_err(job_error)?;
    let slides: Vec<Slide> = batch
        .items
        .iter()
        .filter_map(|item| item.event.as_ref())
        .map(|event| Slide::from_event(event, &zone))
        .collect();
    if slides.is_empty() {
        return Ok(());
    }
    let school = batch.row.school.as_str();
    let outcome = remove_failing(db, &batch, &slides).await;
    let entry = match &outcome {
        Ok(removed) => json!({"removed": removed, "kept": slides.len() - removed.len()}),
        Err(error) => json!({"error": format!("{error:#}"), "kept": slides.len()}),
    };
    log_audit(
        &audit_log_path(),
        json!({
            "at": Utc::now().to_rfc3339(),
            "school": school,
            "batch_id": batch_id.to_string(),
            "result": entry,
        }),
    );
    outcome.map(|_| ())
}

/// Judge the draft's slides, and save it without the failing ones.
async fn remove_failing(
    db: &PgPool,
    batch: &batches::Batch,
    slides: &[Slide],
) -> Result<Vec<Value>> {
    let judgement = judge(&batch.row.school, &batch.row.cover_body, slides).await?;
    let failing = judgement.failing();
    if failing.is_empty() {
        return Ok(Vec::new());
    }
    let failing_ids: Vec<i64> = failing.iter().map(|verdict| verdict.event_id).collect();
    let kept: Vec<i64> = slides
        .iter()
        .map(|slide| slide.id)
        .filter(|id| !failing_ids.contains(id))
        .collect();
    batches::update_batch(
        db,
        batch.row.id,
        DraftUpdate {
            version: i64::from(batch.row.version),
            caption_intro: batch.row.caption_intro.clone(),
            cover_body: kept_cover(&judgement, &batch.row.cover_body),
            event_ids: kept,
        },
    )
    .await
    .map_err(job_error)?;
    // An event that only waits for its place or time is not judged unpromotable.
    let ids: Vec<i32> = failing
        .iter()
        .filter(|verdict| {
            slides
                .iter()
                .any(|slide| slide.id == verdict.event_id && slide.pending.is_none())
        })
        .map(|verdict| verdict.event_id as i32)
        .collect();
    sqlx::query("UPDATE public.events SET promotable = false WHERE id = ANY($1)")
        .bind(&ids)
        .execute(db)
        .await?;
    Ok(failing
        .iter()
        .map(|verdict| {
            let title = slides
                .iter()
                .find(|slide| slide.id == verdict.event_id)
                .map(|slide| slide.title.as_str());
            json!({"event_id": verdict.event_id, "title": title, "reason": verdict.reason})
        })
        .collect())
}

/// `~/.local/state/wat2do/instagram-carousels/draft-audits.jsonl`.
pub fn audit_log_path() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_default())
        .join(".local/state/wat2do/instagram-carousels/draft-audits.jsonl")
}

/// Append one audit to the log; a log that cannot be written only warns.
fn log_audit(path: &Path, entry: Value) {
    tracing::info!("Instagram draft audit: {entry}");
    let written = path
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| {
            let mut file = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)?;
            writeln!(file, "{entry}")
        });
    if let Err(error) = written {
        tracing::warn!("Could not write {}: {error}", path.display());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slide(id: i64) -> Slide {
        Slide {
            id,
            title: format!("Event {id}"),
            club: None,
            category: None,
            description: None,
            location: None,
            price: Value::Null,
            pending: None,
        }
    }

    fn judgement(verdicts: &[(i64, bool)], cover: &str) -> Judgement {
        Judgement {
            verdicts: verdicts
                .iter()
                .map(|(event_id, promotable)| Verdict {
                    event_id: *event_id,
                    promotable: *promotable,
                    reason: "ok".into(),
                })
                .collect(),
            cover_body: cover.into(),
        }
    }

    #[test]
    fn the_prompt_carries_the_promotion_rules() {
        let prompt = prompt().unwrap();
        assert!(!prompt.contains("{{"));
        assert!(prompt.contains(&promotion_rules().unwrap()));
    }

    #[test]
    fn every_slide_gets_exactly_one_verdict() {
        let slides = [slide(1), slide(2)];
        assert!(check_verdicts(&judgement(&[(2, true), (1, false)], ""), &slides).is_ok());
        assert!(check_verdicts(&judgement(&[(1, true)], ""), &slides).is_err());
        assert!(
            check_verdicts(&judgement(&[(1, true), (2, true), (3, true)], ""), &slides).is_err()
        );
        assert_eq!(
            judgement(&[(1, true), (2, false)], "")
                .failing()
                .iter()
                .map(|verdict| verdict.event_id)
                .collect::<Vec<_>>(),
            [2]
        );
    }

    #[test]
    fn a_slide_still_waiting_for_its_place_or_time_fails_whatever_the_agent_says() {
        let mut slides = [slide(1), slide(2)];
        slides[1].pending = Some("location TBD");
        let mut judgement = judgement(&[(1, true), (2, true)], "");
        judgement.fail_pending(&slides);
        let failing = judgement.failing();
        assert_eq!(failing.len(), 1);
        assert_eq!(failing[0].event_id, 2);
        assert_eq!(failing[0].reason, "location TBD");
        assert_eq!(slides[1].to_json()["pending_detail"], "location TBD");
        assert_eq!(slides[0].to_json()["pending_detail"], Value::Null);
    }

    #[test]
    fn an_overlong_cover_keeps_the_drafts() {
        let long = "x".repeat(INSTAGRAM_PUBLISHING.cover_body_character_limit + 1);
        assert_eq!(kept_cover(&judgement(&[], &long), "Old"), "Old");
        assert_eq!(kept_cover(&judgement(&[], " New "), "Old"), "New");
    }

    #[test]
    fn audits_are_appended_to_the_log() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("nested/draft-audits.jsonl");
        log_audit(&path, json!({"school": "uwaterloo"}));
        log_audit(&path, json!({"school": "tmu"}));
        let lines: Vec<String> = std::fs::read_to_string(&path)
            .unwrap()
            .lines()
            .map(str::to_owned)
            .collect();
        assert_eq!(lines, [r#"{"school":"uwaterloo"}"#, r#"{"school":"tmu"}"#]);
    }
}
