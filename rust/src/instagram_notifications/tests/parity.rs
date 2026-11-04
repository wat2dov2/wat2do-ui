//! Parity with the Python worker, from its recorded subprocess traffic.
//!
//! Each fixture under `fixtures/parity/` was recorded by running the Python worker
//! (before it was deleted) against a scripted Brave page model on a virtual clock: every
//! `osascript`, `ioreg` and `security` call it made, with its arguments, stdin and
//! timeout, what the model answered, each step's outcome, and the queue's final jobs,
//! settings and diagnostics. Rust replays the answers and
//! must make exactly the same calls, in the same order, and end in the same state.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use serde_json::{Value, json};

use super::*;
use crate::host::{CommandError, CommandOutput, Host};
use crate::instagram_notifications::browser_queue::BrowserJobQueue;
use crate::instagram_notifications::test_support::{FakeHost, HostCall, bridge};

struct Replay {
    expected: Mutex<VecDeque<Value>>,
    mismatches: Mutex<Vec<String>>,
    index: Mutex<usize>,
}

impl Replay {
    fn answer(&self, call: &HostCall) -> Result<CommandOutput, CommandError> {
        let index = {
            let mut index = self.index.lock().unwrap();
            *index += 1;
            *index - 1
        };
        let Some(expected) = self.expected.lock().unwrap().pop_front() else {
            self.mismatches.lock().unwrap().push(format!(
                "call {index} was not made by Python: {:?}",
                summary(call)
            ));
            return Ok(CommandOutput {
                code: 1,
                stdout: String::new(),
                stderr: "parity: unexpected call".into(),
            });
        };
        let args: Vec<String> = serde_json::from_value(expected["args"].clone()).unwrap();
        let stdin = expected["stdin"].as_str().map(str::to_owned);
        let timeout = expected["timeout"].as_f64().unwrap_or(f64::NAN);
        if expected["program"] != json!(call.program) || args != call.args || stdin != call.stdin {
            self.mismatches.lock().unwrap().push(format!(
                "call {index} differs:\n  python: {:?}\n  rust:   {:?}",
                summary_value(&expected),
                summary(call)
            ));
        } else if (timeout - call.timeout).abs() > 1e-6 {
            self.mismatches.lock().unwrap().push(format!(
                "call {index} timeout differs: python {timeout}, rust {}",
                call.timeout
            ));
        }
        Ok(CommandOutput {
            code: expected["code"].as_i64().unwrap() as i32,
            stdout: expected["stdout"].as_str().unwrap().to_owned(),
            stderr: expected["stderr"].as_str().unwrap().to_owned(),
        })
    }
}

/// The JavaScript (or the script's first line) a call ran, for readable mismatches.
fn summary(call: &HostCall) -> String {
    let script = call.script().unwrap_or_default();
    let detail = call.javascript().unwrap_or(script);
    format!(
        "{} {}",
        call.program,
        detail.chars().take(120).collect::<String>()
    )
}

fn summary_value(call: &Value) -> String {
    let args: Vec<String> = serde_json::from_value(call["args"].clone()).unwrap();
    let detail = if args.len() > 4 && args[0] == "-e" {
        args[4].clone()
    } else {
        args.get(1).cloned().unwrap_or_default()
    };
    format!(
        "{} {}",
        call["program"].as_str().unwrap(),
        detail.chars().take(120).collect::<String>()
    )
}

fn run_step(worker: &Worker, step: &Value, host: &FakeHost) -> Value {
    let queue = &worker.queue;
    let text = |key: &str| step[key].as_str().unwrap_or_default().to_owned();
    let outcome: BrowserResult<Value> = match step["op"].as_str().unwrap() {
        "set_setting" => queue
            .set_setting(&text("key"), step["value"].clone())
            .map(|()| Value::Null),
        "enqueue_digest" => queue
            .enqueue_digest(
                &text("recipient_id"),
                &text("account_username"),
                &text("cache_ent_id"),
            )
            .map(|_| Value::Null),
        "enqueue_engagement" => queue
            .enqueue_engagement(
                &text("school"),
                &text("recipient_id"),
                &text("account_username"),
                &text("post_url"),
                step["event_id"].as_i64(),
                step["dry_run"].as_bool().unwrap_or(false),
            )
            .map(|_| Value::Null),
        "enqueue_retrieval" => queue
            .enqueue_retrieval(
                &text("school"),
                &text("recipient_id"),
                &text("account_username"),
                &text("url"),
                step["cutoff_days"].as_i64().unwrap(),
            )
            .map(|_| Value::Null),
        "process_next_job" => worker.process_next_job(true).map(Value::from),
        "maintain_tab_pool" => worker.maintain_tab_pool().map(Value::from),
        "recover_login" => worker.recover_login(&|| host.time()).map(Value::from),
        other => panic!("unknown step {other}"),
    };
    outcome
        .unwrap_or_else(|error| json!({"error": error.type_name(), "message": error.to_string()}))
}

/// The queue's state as the recorder dumped it.
fn dump(queue: &BrowserJobQueue) -> Value {
    let db = rusqlite::Connection::open(&queue.database_path).unwrap();
    let mut statement = db
        .prepare(
            "SELECT kind,school,recipient_id,account_username,payload,state,result,error,attempts \
             FROM jobs ORDER BY created_at, kind",
        )
        .unwrap();
    let jobs: Vec<Value> = statement
        .query_map([], |row| {
            Ok(json!({
                "kind": row.get::<_, String>(0)?,
                "school": row.get::<_, String>(1)?,
                "recipient_id": row.get::<_, String>(2)?,
                "account_username": row.get::<_, String>(3)?,
                "payload": row.get::<_, String>(4)?,
                "state": row.get::<_, String>(5)?,
                "result": row.get::<_, Option<String>>(6)?,
                "error": row.get::<_, Option<String>>(7)?,
                "attempts": row.get::<_, i64>(8)?,
            }))
        })
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    let mut settings = serde_json::Map::new();
    let mut statement = db
        .prepare("SELECT key, value FROM settings ORDER BY key")
        .unwrap();
    for row in statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .unwrap()
    {
        let (key, value) = row.unwrap();
        if key != "worker" && key != "delivery_generation" {
            settings.insert(key, Value::from(value));
        }
    }
    let mut statement = db
        .prepare("SELECT event FROM diagnostic_events ORDER BY created_at")
        .unwrap();
    let events: Vec<Value> = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .map(|event| {
            let mut event: Value = serde_json::from_str(&event.unwrap()).unwrap();
            let payload = event["payload"].as_object_mut().unwrap();
            payload.remove("recorded_at");
            if payload["job_id"].is_string() {
                payload.insert("job_id".into(), json!("<job>"));
            }
            event
        })
        .collect();
    json!({"jobs": jobs, "settings": settings, "events": events})
}

fn replay(fixture: &str) {
    let fixture: Value = serde_json::from_str(fixture).unwrap();
    let replay = Arc::new(Replay {
        expected: Mutex::new(
            fixture["calls"]
                .as_array()
                .unwrap()
                .iter()
                .cloned()
                .collect(),
        ),
        mismatches: Mutex::new(Vec::new()),
        index: Mutex::new(0),
    });
    let answers = replay.clone();
    let host = FakeHost::new(move |call| answers.answer(call));
    let directory = tempfile::tempdir().unwrap();
    let queue = BrowserJobQueue::open(Some(&directory.path().join("state")), host.clone()).unwrap();
    let mut worker = Worker::new(bridge(&host), queue, None);
    worker.seams.school_account_for = Arc::new(|_| None);
    worker.seams.browser_lock_path = directory.path().join("browser.lock");
    let outcomes: Vec<Value> = fixture["scenario"]["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| run_step(&worker, step, &host))
        .collect();
    let name = fixture["name"].as_str().unwrap();
    let mismatches = replay.mismatches.lock().unwrap().clone();
    assert!(mismatches.is_empty(), "{name}: {}", mismatches.join("\n"));
    let missing = replay.expected.lock().unwrap().len();
    assert_eq!(
        missing, 0,
        "{name}: Rust stopped {missing} calls short of Python"
    );
    assert_eq!(
        Value::from(outcomes),
        fixture["outcomes"],
        "{name}: step outcomes"
    );
    assert_eq!(
        dump(&worker.queue),
        fixture["final"],
        "{name}: final queue state"
    );
}

#[test]
fn digest_after_account_switch() {
    replay(include_str!(
        "fixtures/parity/digest_after_account_switch.json"
    ));
}

#[test]
fn digest_rate_limited() {
    replay(include_str!("fixtures/parity/digest_rate_limited.json"));
}

#[test]
fn engagement_like_and_repost() {
    replay(include_str!(
        "fixtures/parity/engagement_like_and_repost.json"
    ));
}

#[test]
fn engagement_inspection() {
    replay(include_str!("fixtures/parity/engagement_inspection.json"));
}

#[test]
fn profile_listing() {
    replay(include_str!("fixtures/parity/profile_listing.json"));
}

#[test]
fn tab_pool_opens_missing_windows() {
    replay(include_str!(
        "fixtures/parity/tab_pool_opens_missing_windows.json"
    ));
}

#[test]
fn login_recovery_through_saved_profile() {
    replay(include_str!(
        "fixtures/parity/login_recovery_through_saved_profile.json"
    ));
}

/// The Python `process_notification` job's decisions for many real-shaped payloads,
/// recorded with its school lookup, digest resolver and ledger replaced.
#[test]
fn notification_payload_decisions() {
    use crate::instagram_notifications::browser_digest::DigestResolution;
    use crate::instagram_notifications::ledger::NotificationRecord;
    use crate::instagram_notifications::process_notification::{
        Level, NotificationServices, process,
    };

    struct Recorded {
        case: Value,
        resolver_calls: Vec<Value>,
        record: Option<Value>,
    }

    impl NotificationServices for Recorded {
        fn school_for_recipient(&mut self, _: &str) -> anyhow::Result<Option<(i32, String)>> {
            Ok(self.case["school"].as_array().map(|school| {
                (
                    school[0].as_i64().unwrap() as i32,
                    school[1].as_str().unwrap().to_owned(),
                )
            }))
        }

        fn resolve_digest(
            &mut self,
            recipient_id: &str,
            account_username: &str,
            cache_ent_id: &str,
        ) -> BrowserResult<DigestResolution> {
            self.resolver_calls
                .push(json!([recipient_id, account_username, cache_ent_id]));
            let options = &self.case["options"];
            if let Some(error) = options["resolver_error"].as_str() {
                return Err(BrowserError::digest(error));
            }
            let resolved = options
                .get("resolved")
                .cloned()
                .unwrap_or(json!(["555", "111_9"]));
            Ok(DigestResolution {
                account_username: account_username.to_owned(),
                media_ids: serde_json::from_value(resolved).unwrap(),
                page_count: 1,
            })
        }

        fn record(&mut self, record: &NotificationRecord) -> anyhow::Result<(String, i64)> {
            if self.case["options"]["ledger_error"] == json!(true) {
                anyhow::bail!("database detail that must not leak");
            }
            self.record = Some(json!({
                "school_id": record.school_id,
                "intended_recipient_id": record.intended_recipient_id,
                "push_id": record.push_id,
                "push_category": record.push_category,
                "cache_ent_id": record.cache_ent_id,
                "total_non_mmc_media_count": record.total_non_mmc_media_count,
                "media": record.media.iter().map(|item| json!([item.media_id, item.source_url])).collect::<Vec<_>>(),
            }));
            Ok(("id".into(), record.media.len() as i64 - 1))
        }

        fn is_mac(&self) -> bool {
            self.case["options"]["mac"] != json!(false)
        }
    }

    let cases: Value =
        serde_json::from_str(include_str!("fixtures/parity/notifications.json")).unwrap();
    for case in cases.as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let mut services = Recorded {
            case: case.clone(),
            resolver_calls: Vec::new(),
            record: None,
        };
        let mut logs = Vec::new();
        let processed = process(
            case["notification_json"].as_str().unwrap(),
            case["intended_recipient_id"].as_str().unwrap(),
            &mut services,
            &mut |level, message| {
                let level = match level {
                    Level::Info => "INFO",
                    Level::Warning => "WARNING",
                    Level::Error => "ERROR",
                };
                logs.push(json!([level, message]));
            },
        );
        assert_eq!(
            json!(processed.exit_code),
            case["exit_code"],
            "{name}: exit code"
        );
        assert_eq!(
            Value::from(services.resolver_calls),
            case["resolver_calls"],
            "{name}: resolver"
        );
        if name == "invalid json" {
            // serde_json and Python's json module word the decode error differently.
            assert!(
                logs[0][1]
                    .as_str()
                    .unwrap()
                    .starts_with("Failed to decode NOTIFICATION_JSON: ")
            );
        } else {
            assert_eq!(Value::from(logs), case["logs"], "{name}: logs");
        }
        let mut expected = case["record"].clone();
        if let Some(record) = expected.as_object_mut() {
            // Python passed keyword arguments; Rust passes the same values in a struct.
            record
                .remove("media")
                .map(|media| record.insert("media".into(), media));
        }
        assert_eq!(
            services.record.unwrap_or(Value::Null),
            expected,
            "{name}: ledger record"
        );
    }
}

#[test]
fn idle_iterations() {
    replay(include_str!("fixtures/parity/idle_iterations.json"));
}

/// Performance: the worker's idle loop iteration (tab health check and an empty claim)
/// against the recorded Brave answers, repeated. Run with
/// `cargo test --release --lib idle_iteration_timing -- --ignored --nocapture`.
#[test]
#[ignore = "timing measurement, run by hand"]
fn idle_iteration_timing() {
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/parity/idle_iterations.json")).unwrap();
    let calls: Vec<Value> = fixture["calls"].as_array().unwrap()[..5].to_vec();
    let next = Mutex::new(0usize);
    let host = FakeHost::new(move |_| {
        let mut index = next.lock().unwrap();
        let call = &calls[*index % calls.len()];
        *index += 1;
        Ok(CommandOutput {
            code: 0,
            stdout: call["stdout"].as_str().unwrap().to_owned(),
            stderr: String::new(),
        })
    });
    let directory = tempfile::tempdir().unwrap();
    let queue = BrowserJobQueue::open(Some(&directory.path().join("state")), host.clone()).unwrap();
    queue
        .set_setting("browser_tab_ids", json!(["11", "12"]))
        .unwrap();
    let mut worker = Worker::new(bridge(&host), queue, None);
    worker.seams.browser_lock_path = directory.path().join("browser.lock");
    let iterations = 2000;
    let started = std::time::Instant::now();
    for _ in 0..iterations {
        assert!(worker.maintain_tab_pool().unwrap());
        assert!(!worker.process_next_job(true).unwrap());
    }
    let elapsed = started.elapsed();
    println!(
        "rust idle iteration: {iterations} iterations in {:.3}s, {:.1} us each",
        elapsed.as_secs_f64(),
        elapsed.as_secs_f64() * 1e6 / f64::from(iterations)
    );
}
