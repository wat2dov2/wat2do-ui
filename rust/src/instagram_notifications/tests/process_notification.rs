//! Ported from `tests/jobs/test_process_notification.py`, plus fixture-driven cases
//! that feed anonymized, real-shaped Android notification payloads
//! (`fixtures/notifications/*.json`, every value invented).
//!
//! Python set `NOTIFICATION_JSON`/`INTENDED_RECIPIENT_ID` and patched the school
//! lookup, the digest resolver, `sys.platform` and the ledger; here those are the
//! arguments of `process` and a fake `NotificationServices`. `caplog` is the log
//! callback, captured with each line's level.

use serde_json::json;

use super::*;
use crate::instagram_notifications::browser_digest::DigestResolution;

const RECIPIENT_ID: &str = "12342599092";
const PUSH_ID: &str = "push-123";
const PUSH_CATEGORY: &str = "subscription_daily_digest";

struct FakeServices {
    /// `get_school_by_recipient_id`: `None` maps every recipient to this school.
    school: Option<(i32, String)>,
    only_recipient: Option<String>,
    /// What the digest resolver returns; `None` means it must not run.
    digest: Option<BrowserResult<Vec<String>>>,
    digest_calls: Vec<(String, String, String)>,
    records: Vec<NotificationRecord>,
    allow_record: bool,
    mac: bool,
}

impl FakeServices {
    /// `_install_school`: recipient `RECIPIENT_ID` is school 7, `ubc`.
    fn school() -> Self {
        Self {
            school: Some((7, "ubc".into())),
            only_recipient: Some(RECIPIENT_ID.into()),
            digest: None,
            digest_calls: Vec::new(),
            records: Vec::new(),
            allow_record: true,
            mac: false,
        }
    }

    /// No school lookup happened in Python (a test that fails or exits earlier).
    fn unrouted() -> Self {
        Self {
            school: None,
            only_recipient: None,
            ..Self::school()
        }
    }

    /// `_install_digest_resolver`: on the Mac, resolving to `media_ids`.
    fn with_digest(mut self, media_ids: &[&str]) -> Self {
        self.digest = Some(Ok(media_ids.iter().map(|id| (*id).to_owned()).collect()));
        self.mac = true;
        self
    }

    /// The ledger raises `AssertionError("ledger should not run")`.
    fn without_ledger(mut self) -> Self {
        self.allow_record = false;
        self
    }

    fn media_ids(&self) -> Vec<String> {
        self.records[0]
            .media
            .iter()
            .map(|item| item.media_id.clone())
            .collect()
    }
}

impl NotificationServices for FakeServices {
    fn school_for_recipient(
        &mut self,
        recipient_id: &str,
    ) -> anyhow::Result<Option<(i32, String)>> {
        if self
            .only_recipient
            .as_deref()
            .is_some_and(|only| only != recipient_id)
        {
            return Ok(None);
        }
        Ok(self.school.clone())
    }

    fn resolve_digest(
        &mut self,
        recipient_id: &str,
        account_username: &str,
        cache_ent_id: &str,
    ) -> BrowserResult<DigestResolution> {
        self.digest_calls.push((
            recipient_id.to_owned(),
            account_username.to_owned(),
            cache_ent_id.to_owned(),
        ));
        let media_ids = self
            .digest
            .clone()
            .expect("the digest resolver should not run")?;
        Ok(DigestResolution {
            account_username: account_username.to_owned(),
            media_ids,
            page_count: 1,
        })
    }

    fn record(&mut self, record: &NotificationRecord) -> anyhow::Result<(String, i64)> {
        assert!(self.allow_record, "ledger should not run");
        self.records.push(record.clone());
        Ok(("notification-1".into(), record.media.len() as i64))
    }

    fn is_mac(&self) -> bool {
        self.mac
    }
}

struct Run {
    exit_code: i32,
    notice: Option<String>,
    lines: Vec<(Level, String)>,
}

impl Run {
    /// `caplog.text` at `level`: every line at that level or louder.
    fn text(&self, level: Level) -> String {
        let rank = |level: Level| match level {
            Level::Info => 0,
            Level::Warning => 1,
            Level::Error => 2,
        };
        self.lines
            .iter()
            .filter(|(line_level, _)| rank(*line_level) >= rank(level))
            .map(|(_, line)| line.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

fn run_json(json: &str, recipient: &str, services: &mut FakeServices) -> Run {
    let mut lines = Vec::new();
    let processed = process(json, recipient, services, &mut |level, line| {
        lines.push((level, line))
    });
    Run {
        exit_code: processed.exit_code,
        notice: processed.notice,
        lines,
    }
}

fn run(payload: &Value, services: &mut FakeServices) -> Run {
    run_json(&payload.to_string(), RECIPIENT_ID, services)
}

fn actionable_payload(action: &str) -> Value {
    json!({
        "android.subText": "ubc.wat2do.io",
        "com.instagram.android.igns.logging.ig_action": action,
        "com.instagram.android.igns.logging.push_category": PUSH_CATEGORY,
        "com.instagram.android.igns.logging.push_id": PUSH_ID,
        "com.instagram.android.igns.logging.intended_recipient_id": RECIPIENT_ID,
    })
}

fn post_url(media_id: u128) -> String {
    format!(
        "https://www.instagram.com/p/{}/",
        shortcode_from_media_id(media_id)
    )
}

#[test]
fn test_digest_uses_current_school_identity_after_account_rename() {
    for (school_slug, notification_label, expected_username) in [
        ("ubc", "ubc.wat2do.io", "wat2do.ubc"),
        ("utsc", "utsc.wat2do.io", "wat2do.utsc"),
        ("uwaterloo", "wat2do.ca", "wat2do.uwaterloo"),
    ] {
        let mut payload = actionable_payload("clips_home?cache_ent_id=cache-123");
        payload["android.subText"] = Value::from(notification_label);
        let mut services = FakeServices {
            school: Some((7, school_slug.into())),
            only_recipient: None,
            ..FakeServices::school()
        }
        .with_digest(&["123456789"]);

        assert_eq!(run(&payload, &mut services).exit_code, 0);
        assert_eq!(
            services.digest_calls,
            vec![(
                RECIPIENT_ID.to_owned(),
                expected_username.to_owned(),
                "cache-123".to_owned()
            )]
        );
    }
}

#[test]
fn test_media_notification_records_ordered_unique_exact_claims() {
    let first_media_id = 123456789u128;
    let second_media_id = 987654321u128;
    let payload = actionable_payload(&format!(
        "clips_home?media_list={first_media_id}_1,{first_media_id}_2&media_id={second_media_id}_3"
    ));
    let mut services = FakeServices::school();

    assert_eq!(run(&payload, &mut services).exit_code, 0);

    let record = &services.records[0];
    assert_eq!(
        record
            .media
            .iter()
            .map(|item| item.source_url.clone())
            .collect::<Vec<_>>(),
        vec![post_url(first_media_id), post_url(second_media_id)]
    );
    assert_eq!(record.school_id, 7);
    assert_eq!(record.intended_recipient_id, RECIPIENT_ID);
    assert_eq!(record.push_id, PUSH_ID);
}

#[test]
fn test_digest_expands_hidden_media_before_recording_and_keeps_metadata() {
    let payload = actionable_payload(
        "clips_home?media_list=123456789_1,987654321_2&cache_ent_id=cache-123&\
         total_non_mmc_media_count=4",
    );
    let mut services = FakeServices::school().with_digest(&["111111111", "222222222"]);

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 0);

    assert_eq!(
        services.media_ids(),
        vec!["123456789", "987654321", "111111111", "222222222"]
    );
    assert_eq!(
        services.digest_calls,
        vec![(
            RECIPIENT_ID.to_owned(),
            "wat2do.ubc".to_owned(),
            "cache-123".to_owned()
        )]
    );
    assert_eq!(
        services.records[0].cache_ent_id.as_deref(),
        Some("cache-123")
    );
    assert_eq!(services.records[0].total_non_mmc_media_count, Some(4));
    assert!(
        run.text(Level::Info)
            .contains("Expanded Instagram digest through wat2do.ubc to 4 exact media target")
    );
}

#[test]
fn test_incomplete_digest_is_recorded_and_processes_explicit_media() {
    let payload = actionable_payload("clips_home?media_id=123456789&total_non_mmc_media_count=4");
    let mut services = FakeServices::school();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 0);

    assert!(
        run.text(Level::Warning)
            .contains("returned 1 of 4 advertised media items")
    );
    assert_eq!(services.records[0].total_non_mmc_media_count, Some(4));
}

#[test]
fn test_unrelated_notification_is_a_sanitized_noop() {
    let sensitive_marker = "must-never-reach-logs";
    let payload = json!({
        "com.instagram.android.igns.logging.push_category": "suggested_close_friend",
        "com.instagram.android.igns.logging.ig_action": "user?username=suggested_account",
        "android.text": sensitive_marker,
    });
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 0);

    let text = run.text(Level::Info);
    assert!(text.contains("Ignoring unsupported Instagram notification"));
    assert!(!text.contains(sensitive_marker));
    assert!(!text.contains("suggested_account"));
}

#[test]
fn test_unrelated_notification_with_media_shape_is_a_noop() {
    let mut payload = actionable_payload("clips_home?media_id=not-a-media-id");
    payload["com.instagram.android.igns.logging.push_category"] =
        Value::from("suggested_close_friend");
    let mut services = FakeServices::unrouted().without_ledger();

    assert_eq!(run(&payload, &mut services).exit_code, 0);
}

#[test]
fn test_cache_only_digest_is_expanded_before_validation() {
    let payload =
        actionable_payload("clips_home?cache_ent_id=cache-123&total_non_mmc_media_count=2");
    let mut services = FakeServices::school().with_digest(&["123456789", "987654321"]);

    assert_eq!(run(&payload, &mut services).exit_code, 0);
    assert_eq!(services.media_ids(), vec!["123456789", "987654321"]);
}

#[test]
fn test_digest_without_advertised_count_still_uses_shared_queue() {
    for explicit_media in ["", "media_id=123456789&"] {
        let payload = actionable_payload(&format!(
            "clips_home?{explicit_media}cache_ent_id=cache-123"
        ));
        let mut services = FakeServices::school().with_digest(&["123456789", "987654321"]);

        assert_eq!(
            run(&payload, &mut services).exit_code,
            0,
            "{explicit_media}"
        );

        assert_eq!(
            services.digest_calls,
            vec![(
                RECIPIENT_ID.to_owned(),
                "wat2do.ubc".to_owned(),
                "cache-123".to_owned()
            )]
        );
        assert_eq!(services.media_ids(), vec!["123456789", "987654321"]);
    }
}

#[test]
fn test_digest_resolution_failure_stops_before_ledger_recording() {
    let payload = actionable_payload(
        "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=2",
    );
    let mut services = FakeServices {
        digest: Some(Err(BrowserError::digest("sanitized browser failure"))),
        mac: true,
        ..FakeServices::school()
    }
    .without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(run.text(Level::Error).contains("sanitized browser failure"));
}

#[test]
fn test_cache_digest_requires_browser_capable_runner() {
    let payload = actionable_payload(
        "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=2",
    );
    let mut services = FakeServices::school().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(
        run.text(Level::Error)
            .contains("requires the browser-capable Mac runner")
    );
    assert!(services.digest_calls.is_empty());
}

#[test]
fn test_terminal_digest_shortfall_processes_every_available_media() {
    let payload = actionable_payload(
        "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=3",
    );
    let mut services = FakeServices::school().with_digest(&["987654321"]);

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 0);

    assert_eq!(services.media_ids(), vec!["123456789", "987654321"]);
    assert!(
        run.text(Level::Warning)
            .contains("returned 2 of 3 advertised media items")
    );
}

#[test]
fn test_digest_over_count_stops_before_ledger_recording() {
    let payload = actionable_payload(
        "clips_home?media_list=123456789,987654321&cache_ent_id=cache-123&total_non_mmc_media_count=1",
    );
    let mut services = FakeServices {
        mac: true,
        ..FakeServices::school()
    }
    .without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(
        run.text(Level::Error)
            .contains("resolved more media IDs than advertised")
    );
}

#[test]
fn test_invalid_media_notification_fails_without_logging_identifier() {
    let sensitive_marker = "invalid-secret-media-id";
    let payload = actionable_payload(&format!("clips_home?media_id={sensitive_marker}"));
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    let text = run.text(Level::Error);
    assert!(text.contains("invalid media ID"));
    assert!(!text.contains(sensitive_marker));
}

#[test]
fn test_actionable_notification_requires_push_id() {
    let mut payload = actionable_payload("clips_home?media_id=123456789");
    payload
        .as_object_mut()
        .unwrap()
        .remove("com.instagram.android.igns.logging.push_id");
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(run.text(Level::Error).contains("requires a valid push ID"));
}

#[test]
fn test_payload_recipient_must_match_workflow_routing() {
    let mut payload = actionable_payload("clips_home?media_id=123456789");
    payload["com.instagram.android.igns.logging.intended_recipient_id"] =
        Value::from("99999999999");
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(
        run.text(Level::Error)
            .contains("does not match workflow routing")
    );
}

#[test]
fn test_workflow_recipient_must_be_canonical() {
    let payload = actionable_payload("clips_home?media_id=123456789");
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run_json(
        &payload.to_string(),
        &format!("0{RECIPIENT_ID}"),
        &mut services,
    );
    assert_eq!(run.exit_code, 1);

    assert!(
        run.text(Level::Error)
            .contains("valid intended recipient ID")
    );
}

#[test]
fn test_non_object_notification_json_fails() {
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&json!(["not", "an", "object"]), &mut services);
    assert_eq!(run.exit_code, 1);

    assert!(
        run.text(Level::Error)
            .contains("must contain a JSON object")
    );
}

fn dm_payload(action: &str) -> Value {
    json!({
        "android.text": "must-never-reach-logs",
        "com.instagram.android.igns.logging.ig_action": action,
        "com.instagram.android.igns.logging.push_category": "direct_v2_clips_share",
        "com.instagram.android.igns.logging.push_id": PUSH_ID,
        "com.instagram.android.igns.logging.intended_recipient_id": RECIPIENT_ID,
    })
}

#[test]
fn test_a_dm_notification_is_left_to_the_inbox_sweep() {
    let payload = dm_payload("direct_v2?id=340282366841710300949128&x=31337&clip_id=9");
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run(&payload, &mut services);
    assert_eq!(run.exit_code, 0);

    let text = run.text(Level::Info);
    assert!(text.contains("Ignoring unsupported Instagram notification."));
    assert!(!text.contains("must-never-reach-logs"));
}

// Fixture-driven cases: anonymized, real-shaped Android notification extras.

const SINGLE_POST: &str = include_str!("fixtures/notifications/single_post.json");
const POSTED_AND_OTHERS: &str =
    include_str!("fixtures/notifications/posted_and_others_digest.json");
const REEL: &str = include_str!("fixtures/notifications/reel.json");
const DM_SHARE: &str = include_str!("fixtures/notifications/dm_share.json");
const SUGGESTED_ACCOUNT: &str = include_str!("fixtures/notifications/suggested_account.json");

fn fixture_text(fixture: &str, key: &str) -> String {
    let payload: Value = serde_json::from_str(fixture).unwrap();
    payload[key].as_str().unwrap().to_owned()
}

#[test]
fn fixture_single_post_records_its_one_exact_post() {
    let mut services = FakeServices::school();

    let run = run_json(SINGLE_POST, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 0);
    assert_eq!(services.records.len(), 1);
    let record = &services.records[0];
    assert_eq!(
        record.media,
        vec![MaterializedMedia {
            media_id: "3456789012345678901".into(),
            source_url: post_url(3456789012345678901),
        }]
    );
    assert_eq!(record.school_id, 7);
    assert_eq!(record.intended_recipient_id, RECIPIENT_ID);
    assert_eq!(record.push_id, "fixture-push-0001");
    assert_eq!(record.push_category, "post");
    assert_eq!(record.cache_ent_id, None);
    assert_eq!(record.total_non_mmc_media_count, None);
    assert!(services.digest_calls.is_empty());
    assert_eq!(
        run.notice.as_deref(),
        Some("Successfully queued 1 new Instagram posts (ignored 0 duplicates) to the ledger.")
    );
    let logged = run.text(Level::Info);
    assert!(!logged.contains(&fixture_text(SINGLE_POST, "android.text")));
}

#[test]
fn fixture_posted_and_others_digest_expands_through_the_browser_before_recording() {
    let mut services =
        FakeServices::school().with_digest(&["3456789012345678902", "3456789012345678903_99"]);

    let run = run_json(POSTED_AND_OTHERS, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 0);
    assert_eq!(
        services.digest_calls,
        vec![(
            RECIPIENT_ID.to_owned(),
            "wat2do.ubc".to_owned(),
            "fixture-cache-0002".to_owned()
        )]
    );
    let record = &services.records[0];
    assert_eq!(
        services.media_ids(),
        vec!["3456789012345678902", "3456789012345678903"]
    );
    assert_eq!(record.media[1].source_url, post_url(3456789012345678903));
    assert_eq!(record.push_category, "subscription_daily_digest");
    assert_eq!(record.cache_ent_id.as_deref(), Some("fixture-cache-0002"));
    assert_eq!(record.total_non_mmc_media_count, Some(3));
    let warnings = run.text(Level::Warning);
    assert!(
        warnings.contains("Instagram returned 2 of 3 advertised media items"),
        "{warnings}"
    );
    assert!(
        run.text(Level::Info)
            .contains("Expanded Instagram digest through wat2do.ubc to 2 exact media target(s).")
    );
    assert_eq!(
        run.notice.as_deref(),
        Some("Successfully queued 2 new Instagram posts (ignored 0 duplicates) to the ledger.")
    );
}

#[test]
fn fixture_posted_and_others_digest_off_the_mac_records_nothing() {
    let mut services = FakeServices::school().without_ledger();

    let run = run_json(POSTED_AND_OTHERS, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 1);
    assert!(
        run.text(Level::Error)
            .contains("CacheEntID expansion requires the browser-capable Mac runner")
    );
    assert_eq!(run.notice, None);
}

#[test]
fn fixture_reel_records_its_media_as_a_post_permalink() {
    let mut services = FakeServices::school();

    let run = run_json(REEL, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 0);
    assert_eq!(
        services.records[0].media,
        vec![MaterializedMedia {
            media_id: "3456789012345678904".into(),
            source_url: post_url(3456789012345678904),
        }]
    );
    assert_eq!(services.records[0].push_id, "fixture-push-0004");
}

#[test]
fn fixture_dm_share_is_ignored_without_logging_its_text() {
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run_json(DM_SHARE, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 0);
    assert_eq!(run.notice, None);
    assert_eq!(
        run.lines,
        vec![(
            Level::Info,
            "Ignoring unsupported Instagram notification.".to_owned()
        )]
    );
    assert!(services.digest_calls.is_empty());
}

#[test]
fn fixture_suggested_account_is_ignored_without_logging_the_account() {
    let mut services = FakeServices::unrouted().without_ledger();

    let run = run_json(SUGGESTED_ACCOUNT, RECIPIENT_ID, &mut services);

    assert_eq!(run.exit_code, 0);
    assert_eq!(run.notice, None);
    let logged = run.text(Level::Info);
    assert_eq!(logged, "Ignoring unsupported Instagram notification.");
    assert!(!logged.contains("fixture_suggested_account"));
}
