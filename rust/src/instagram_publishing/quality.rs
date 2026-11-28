//! The curation quality test (`wat2do-instagram quality-test`): the live
//! curation prompt and the draft audit run several times against a fixed
//! packet (`testdata/curation_quality.json`: real past events plus a few made
//! up) on the quality login, and every event is checked against what Wat2Do
//! must and must never promote. Rerun it after every change to the curation
//! prompt, the audit prompt or the promotion rules; it writes an HTML report
//! with a pass or fail per event and per check.
//!
//! A full run checks that no banned event is ever picked, that every great
//! event is picked and the first slides are great ones, that at most
//! `maximum_slides_per_post` events come from one post and a big-prize
//! competition never takes the first three slides. A thin run (only three
//! good events beside the banned ones) checks the carousel stays short rather
//! than filling up with banned events. The audit run checks the audit fails
//! every banned event and passes every other one.

use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::{DateTime, Duration, NaiveTime, Utc};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Map, Value};

use super::audit::{self, Slide};
use super::curation::{answer_with_retries, packet_document, run, selection_from_answer};
use super::drafts::{Candidate, NEEDS_REVIEW, OpenPacket, Outcome, Packet, local_date};
use crate::controlbox::INSTAGRAM_PUBLISHING;

const FIXTURE: &str = include_str!("testdata/curation_quality.json");
const PARALLEL_RUNS: usize = 3;

#[derive(Debug, Deserialize)]
struct Fixture {
    school: String,
    language: String,
    caption_intro: String,
    excluded_clubs: Vec<String>,
    /// The only good events in the thin run.
    thin_events: Vec<i64>,
    events: Vec<FixtureEvent>,
}

#[derive(Debug, Clone, Deserialize)]
struct FixtureEvent {
    id: i64,
    title: String,
    club: Option<String>,
    ig_handle: Option<String>,
    category: Option<String>,
    description: Option<String>,
    location: Option<String>,
    price: Option<Value>,
    food: Value,
    registration: bool,
    source_post: Option<String>,
    /// Days from now, and the local start time.
    day: i64,
    start: String,
    /// `banned`, `great` or `ok`.
    expect: String,
    why: String,
    /// A big-prize competition: allowed, never in the first three slides.
    #[serde(default)]
    prize: bool,
    /// Events read from one post, of which at most `maximum_slides_per_post` may be picked.
    #[serde(default)]
    group: Option<String>,
    /// An excluded club's event: code keeps it out, so the audit need not fail it.
    #[serde(default)]
    excluded: bool,
}

impl FixtureEvent {
    fn banned(&self) -> bool {
        self.expect == "banned"
    }

    fn great(&self) -> bool {
        self.expect == "great"
    }

    fn candidate(&self, now: DateTime<Utc>) -> Result<Candidate> {
        let time = NaiveTime::parse_from_str(&self.start, "%H:%M")?;
        // Toronto is UTC-5 through the winter; a slide only needs a plausible time.
        let start = (now.date_naive() + Duration::days(self.day))
            .and_time(time)
            .and_utc()
            + Duration::hours(5);
        Ok(Candidate {
            id: self.id,
            title: self.title.clone(),
            description: self.description.clone(),
            location: self.location.clone(),
            club: self.club.clone(),
            ig_handle: self.ig_handle.clone(),
            source_image_url: None,
            category: self.category.clone(),
            employers_on_campus: None,
            price: self.price.clone(),
            food: Some(self.food.clone()),
            registration: self.registration,
            carousel_requested_at: None,
            source_url: self.source_post.clone(),
            dtstart_utc: start,
            dtend_utc: Some(start + Duration::hours(2)),
            tz: "America/Toronto".into(),
        })
    }
}

/// One curation run's picks, in slide order, or why it failed.
type Picks = Result<Vec<i64>, String>;

/// One audit run's verdict per event (passes, and why), or why it failed.
type Verdicts = BTreeMap<i64, (bool, String)>;

/// Every run's outcome, ready to check and report.
struct Results {
    full: Vec<Picks>,
    thin: Vec<Picks>,
    audit: Vec<Result<Verdicts, String>>,
}

/// Run the test `runs` times over, write the report to `out`, and say whether
/// every check passed.
pub async fn run_quality_test(runs: usize, out: &Path) -> Result<bool> {
    let fixture: Fixture = serde_json::from_str(FIXTURE).context("curation_quality.json")?;
    let now = Utc::now();
    let all: Vec<Candidate> = fixture
        .events
        .iter()
        .map(|event| event.candidate(now))
        .collect::<Result<_>>()?;
    let thin: Vec<Candidate> = fixture
        .events
        .iter()
        .zip(&all)
        .filter(|(event, _)| event.banned() || fixture.thin_events.contains(&event.id))
        .map(|(_, candidate)| candidate.clone())
        .collect();
    let full_packet = packet(&fixture, all.clone(), now);
    let thin_packet = packet(&fixture, thin, now);
    let curate = |packet: &Packet| {
        let packet = packet.clone();
        let language = fixture.language.clone();
        async move { curate_once(&packet, &language).await }
    };
    let full = futures_util::stream::iter((0..runs).map(|_| curate(&full_packet)))
        .buffer_unordered(PARALLEL_RUNS)
        .collect()
        .await;
    let thin = futures_util::stream::iter((0..runs).map(|_| curate(&thin_packet)))
        .buffer_unordered(PARALLEL_RUNS)
        .collect()
        .await;
    let slides: Vec<Slide> = all.iter().map(Slide::from).collect();
    let audit = futures_util::stream::iter((0..runs).map(|_| async {
        audit::judge(&fixture.school, "", &slides)
            .await
            .map(|judgement| {
                judgement
                    .verdicts
                    .into_iter()
                    .map(|verdict| (verdict.event_id, (verdict.promotable, verdict.reason)))
                    .collect()
            })
            .map_err(|error| format!("{error:#}"))
    }))
    .buffer_unordered(PARALLEL_RUNS)
    .collect()
    .await;
    let results = Results { full, thin, audit };
    let report = Report::check(&fixture, &results);
    std::fs::write(out, report.html(&fixture, &results, now))
        .with_context(|| format!("could not write {}", out.display()))?;
    Ok(report.passed())
}

fn packet(fixture: &Fixture, events: Vec<Candidate>, now: DateTime<Utc>) -> Packet {
    Packet {
        account_key: fixture.school.clone(),
        publishing_connected: true,
        requires_reauthorization: false,
        local_date: local_date(now),
        window_end: now,
        batch_id: None,
        status: NEEDS_REVIEW.into(),
        open: Some(OpenPacket {
            window_start: now - Duration::days(1),
            caption_intro: fixture.caption_intro.clone(),
            events,
            excluded_clubs: fixture.excluded_clubs.clone(),
        }),
    }
}

/// Curation exactly as the daily job runs it (the live prompt, its checks and
/// its one retry), on the quality login, without saving anything.
async fn curate_once(packet: &Packet, language: &str) -> Picks {
    let attempt = async {
        let workdir = tempfile::Builder::new()
            .prefix("wat2do-instagram-quality-")
            .tempdir()?;
        let posters = vec![None; packet.open.as_ref().map_or(0, |open| open.events.len())];
        std::fs::write(
            workdir.path().join("packet.json"),
            packet_document(packet, language.into(), &posters)?,
        )?;
        let picked = Mutex::new(Vec::new());
        let ask =
            async |prompt: &str| run(prompt, workdir.path(), audit::quality_environment()).await;
        let save = async |answer: &Map<String, Value>| {
            let selection = selection_from_answer(packet, Some(language), answer)?;
            *picked.lock().expect("picks") =
                selection.picks.iter().map(|pick| pick.event_id).collect();
            Ok(Outcome::Saved)
        };
        answer_with_retries(ask, save).await?;
        anyhow::Ok(picked.into_inner().expect("picks"))
    };
    attempt.await.map_err(|error| format!("{error:#}"))
}

/// Pass or fail, with why, for one check.
struct Check {
    name: String,
    passed: bool,
    detail: String,
}

struct Report {
    /// Per event: whether it passed, and what happened to it.
    events: BTreeMap<i64, (bool, String)>,
    checks: Vec<Check>,
}

impl Report {
    fn passed(&self) -> bool {
        self.events.values().all(|(passed, _)| *passed)
            && self.checks.iter().all(|check| check.passed)
    }

    fn check(fixture: &Fixture, results: &Results) -> Self {
        let full: Vec<&Vec<i64>> = results
            .full
            .iter()
            .filter_map(|run| run.as_ref().ok())
            .collect();
        let thin: Vec<&Vec<i64>> = results
            .thin
            .iter()
            .filter_map(|run| run.as_ref().ok())
            .collect();
        let audits: Vec<&Verdicts> = results
            .audit
            .iter()
            .filter_map(|run| run.as_ref().ok())
            .collect();
        let mut events = BTreeMap::new();
        for event in &fixture.events {
            let picked = full
                .iter()
                .filter(|picks| picks.contains(&event.id))
                .count();
            let thin_picked = thin
                .iter()
                .filter(|picks| picks.contains(&event.id))
                .count();
            let failed_by_audit = audits
                .iter()
                .filter(|audit| audit.get(&event.id).is_some_and(|(ok, _)| !ok))
                .count();
            let audit_reasons: Vec<&str> = audits
                .iter()
                .filter_map(|audit| audit.get(&event.id))
                .map(|(_, reason)| reason.as_str())
                .collect();
            let (passed, rule) = if event.banned() {
                (
                    picked == 0
                        && thin_picked == 0
                        && (event.excluded || failed_by_audit == audits.len()),
                    if event.excluded {
                        "never picked"
                    } else {
                        "never picked; the audit fails it"
                    },
                )
            } else if event.great() && event.group.is_none() {
                (
                    picked == full.len() && failed_by_audit == 0,
                    "picked in every run; the audit passes it",
                )
            } else {
                (failed_by_audit == 0, "the audit passes it")
            };
            events.insert(
                event.id,
                (
                    passed,
                    format!(
                        "{rule}. Picked in {picked}/{} full runs and {thin_picked}/{} thin runs; \
                         failed by {failed_by_audit}/{} audits ({})",
                        full.len(),
                        thin.len(),
                        audits.len(),
                        audit_reasons.join(", ")
                    ),
                ),
            );
        }
        let mut checks = Vec::new();
        let failures: Vec<String> = [("full", &results.full), ("thin", &results.thin)]
            .into_iter()
            .flat_map(|(name, runs)| {
                runs.iter().filter_map(move |run| {
                    run.as_ref().err().map(|error| format!("{name}: {error}"))
                })
            })
            .chain(
                results
                    .audit
                    .iter()
                    .filter_map(|run| run.as_ref().err().map(|error| format!("audit: {error}"))),
            )
            .collect();
        checks.push(Check {
            name: "Every run answered".into(),
            passed: failures.is_empty(),
            detail: if failures.is_empty() {
                "All runs gave a valid answer.".into()
            } else {
                failures.join("; ")
            },
        });
        let great: Vec<i64> = fixture
            .events
            .iter()
            .filter(|event| event.great())
            .map(|event| event.id)
            .collect();
        let leads = full
            .iter()
            .filter(|picks| picks.iter().take(3).all(|id| great.contains(id)))
            .count();
        checks.push(Check {
            name: "Great events lead the carousel".into(),
            passed: leads == full.len(),
            detail: format!(
                "The first three slides were all great events in {leads}/{} full runs.",
                full.len()
            ),
        });
        let prize: Vec<i64> = fixture
            .events
            .iter()
            .filter(|event| event.prize)
            .map(|event| event.id)
            .collect();
        let early_prize = full
            .iter()
            .filter(|picks| picks.iter().take(3).any(|id| prize.contains(id)))
            .count();
        checks.push(Check {
            name: "A big-prize competition never takes the first three slides".into(),
            passed: early_prize == 0,
            detail: format!("It did in {early_prize}/{} full runs.", full.len()),
        });
        let crowded = full
            .iter()
            .filter(|picks| {
                let mut per_post: BTreeMap<&str, usize> = BTreeMap::new();
                for id in picks.iter() {
                    let post = fixture
                        .events
                        .iter()
                        .find(|event| event.id == *id)
                        .and_then(|event| event.source_post.as_deref());
                    if let Some(post) = post {
                        *per_post.entry(post).or_default() += 1;
                    }
                }
                per_post
                    .values()
                    .any(|count| *count > INSTAGRAM_PUBLISHING.maximum_slides_per_post)
            })
            .count();
        checks.push(Check {
            name: "At most two events from one post".into(),
            passed: crowded == 0,
            detail: format!("Over the cap in {crowded}/{} full runs.", full.len()),
        });
        let short = thin
            .iter()
            .filter(|picks| {
                let mut sorted: Vec<i64> = picks.to_vec();
                sorted.sort_unstable();
                let mut expected = fixture.thin_events.clone();
                expected.sort_unstable();
                sorted == expected
            })
            .count();
        checks.push(Check {
            name: "A thin packet makes a short carousel".into(),
            passed: short == thin.len(),
            detail: format!(
                "Exactly the {} good events, none banned, in {short}/{} thin runs.",
                fixture.thin_events.len(),
                thin.len()
            ),
        });
        Self { events, checks }
    }

    fn html(&self, fixture: &Fixture, results: &Results, now: DateTime<Utc>) -> String {
        let escape = |text: &str| {
            text.replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;")
                .replace('"', "&quot;")
        };
        let badge = |passed: bool| {
            if passed {
                r#"<span class="pass">pass</span>"#
            } else {
                r#"<span class="fail">fail</span>"#
            }
        };
        let title = |id: i64| {
            fixture
                .events
                .iter()
                .find(|event| event.id == id)
                .map_or_else(|| id.to_string(), |event| event.title.clone())
        };
        let mut body = String::new();
        body.push_str(&format!(
            "<h1>Carousel quality test</h1><p class=\"lede\">{} at {} UTC: the live curation prompt \
             ({}) and the draft audit ({}) on the quality login, {} runs each.</p>",
            badge(self.passed()),
            now.format("%Y-%m-%d %H:%M"),
            escape(&INSTAGRAM_PUBLISHING.curation_model),
            escape(&INSTAGRAM_PUBLISHING.draft_audit_model),
            results.full.len()
        ));
        body.push_str("<h2>Checks</h2><table><tr><th></th><th>Check</th><th>Detail</th></tr>");
        for check in &self.checks {
            body.push_str(&format!(
                "<tr><td>{}</td><td>{}</td><td>{}</td></tr>",
                badge(check.passed),
                escape(&check.name),
                escape(&check.detail)
            ));
        }
        body.push_str("</table><h2>Events</h2><table><tr><th></th><th>Event</th><th>Expected</th><th>What happened</th></tr>");
        for event in &fixture.events {
            let (passed, detail) = &self.events[&event.id];
            body.push_str(&format!(
                "<tr><td>{}</td><td><b>{}</b><br><small>{}</small></td><td>{}<br><small>{}</small></td><td>{}</td></tr>",
                badge(*passed),
                escape(&event.title),
                escape(event.club.as_deref().unwrap_or("")),
                escape(&event.expect),
                escape(&event.why),
                escape(detail)
            ));
        }
        body.push_str("</table><h2>Carousels</h2>");
        for (name, runs) in [("Full", &results.full), ("Thin", &results.thin)] {
            for (index, run) in runs.iter().enumerate() {
                let line = match run {
                    Ok(picks) => picks
                        .iter()
                        .enumerate()
                        .map(|(slide, id)| format!("{}. {}", slide + 1, escape(&title(*id))))
                        .collect::<Vec<_>>()
                        .join("<br>"),
                    Err(error) => format!("failed: {}", escape(error)),
                };
                body.push_str(&format!(
                    "<div class=\"run\"><h3>{name} run {}</h3><p>{line}</p></div>",
                    index + 1
                ));
            }
        }
        format!(
            r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Carousel quality test</title><style>
:root {{ --bg: #fff; --fg: #151515; --muted: #666; --line: #e3e3e3; --pass: #1a7f37; --fail: #c62828; }}
@media (prefers-color-scheme: dark) {{ :root {{ --bg: #141414; --fg: #eee; --muted: #9a9a9a; --line: #2c2c2c; --pass: #4cc26b; --fail: #ff6b6b; }} }}
body {{ background: var(--bg); color: var(--fg); font: 15px/1.5 -apple-system, system-ui, sans-serif; margin: 0 auto; max-width: 1100px; padding: 24px 16px; }}
table {{ border-collapse: collapse; width: 100%; margin-bottom: 24px; }}
th, td {{ border-bottom: 1px solid var(--line); padding: 8px; text-align: left; vertical-align: top; }}
small, .lede {{ color: var(--muted); }}
.pass, .fail {{ font-weight: 700; text-transform: uppercase; font-size: 12px; }}
.pass {{ color: var(--pass); }} .fail {{ color: var(--fail); }}
.run {{ display: inline-block; vertical-align: top; width: 320px; max-width: 100%; margin: 0 16px 16px 0; }}
</style></head><body>{body}</body></html>"#
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Fixture {
        serde_json::from_str(FIXTURE).unwrap()
    }

    #[test]
    fn the_fixture_covers_every_kind_of_event() {
        let fixture = fixture();
        let now = Utc::now();
        for event in &fixture.events {
            assert!(["banned", "great", "ok"].contains(&event.expect.as_str()));
            let candidate = event.candidate(now).unwrap();
            assert!(candidate.dtstart_utc > now);
            // Code alone keeps out events still waiting for their place or time.
            assert_eq!(candidate.pending_detail(), None, "{}", event.title);
        }
        let count = |expect: &str| {
            fixture
                .events
                .iter()
                .filter(|event| event.expect == expect)
                .count()
        };
        assert!(count("banned") >= 20);
        assert!(count("great") >= INSTAGRAM_PUBLISHING.minimum_event_slides);
        // The thin run has fewer good events than slides, so a full carousel needs a banned one.
        assert!(fixture.thin_events.len() < INSTAGRAM_PUBLISHING.maximum_event_slides);
        assert!(fixture.events.iter().any(|event| event.prize));
    }

    #[test]
    fn a_perfect_set_of_runs_passes_and_a_banned_pick_fails() {
        let fixture = fixture();
        let great: Vec<i64> = fixture
            .events
            .iter()
            .filter(|event| event.great() && event.group.is_none())
            .map(|event| event.id)
            .collect();
        let verdicts: Verdicts = fixture
            .events
            .iter()
            .map(|event| (event.id, (!event.banned(), "ok".into())))
            .collect();
        let good = Results {
            full: vec![Ok(great.clone())],
            thin: vec![Ok(fixture.thin_events.clone())],
            audit: vec![Ok(verdicts.clone())],
        };
        assert!(Report::check(&fixture, &good).passed());

        let banned = fixture
            .events
            .iter()
            .find(|event| event.banned())
            .unwrap()
            .id;
        let mut with_banned = great.clone();
        with_banned.push(banned);
        let bad = Results {
            full: vec![Ok(with_banned)],
            thin: vec![Ok(fixture.thin_events.clone())],
            audit: vec![Ok(verdicts)],
        };
        let report = Report::check(&fixture, &bad);
        assert!(!report.passed());
        assert!(!report.events[&banned].0);
        assert!(
            report
                .html(&fixture, &bad, Utc::now())
                .contains("class=\"fail\"")
        );
    }
}
