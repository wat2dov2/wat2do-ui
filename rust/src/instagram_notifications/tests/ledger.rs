//! Ported from `tests/services/instagram_notifications/test_ledger.py`.
//!
//! Python asserted the `record_instagram_notification_media` RPC parameters its fake
//! data API client received; Rust builds those in `NotificationRecord::arguments()`.
//! The RPC's returned `(notification_id, newly_inserted_count)` comes from Postgres and
//! is not reachable without a database.

use serde_json::json;

use super::*;

fn media(media_id: &str, source_url: &str) -> MaterializedMedia {
    MaterializedMedia {
        media_id: media_id.to_owned(),
        source_url: source_url.to_owned(),
    }
}

fn record() -> NotificationRecord {
    NotificationRecord {
        school_id: 7,
        intended_recipient_id: "76214170483".into(),
        push_id: "push-123".into(),
        push_category: "subscription_daily_digest".into(),
        cache_ent_id: Some("cache-456".into()),
        total_non_mmc_media_count: Some(3),
        media: vec![
            media("3701234567890123456", "https://www.instagram.com/p/ABC123/"),
            media("3701234567890123457", "https://www.instagram.com/p/ABC124/"),
        ],
    }
}

#[test]
fn test_record_notification_media_records_metadata_and_returns_id() {
    assert_eq!(
        record().arguments().unwrap(),
        json!({
            "p_school_id": 7,
            "p_intended_recipient_id": "76214170483",
            "p_push_id": "push-123",
            "p_push_category": "subscription_daily_digest",
            "p_cache_ent_id": "cache-456",
            "p_total_non_mmc_media_count": 3,
            "p_media": [
                {
                    "media_id": "3701234567890123456",
                    "source_url": "https://www.instagram.com/p/ABC123/",
                },
                {
                    "media_id": "3701234567890123457",
                    "source_url": "https://www.instagram.com/p/ABC124/",
                },
            ],
        })
    );
}

#[test]
fn test_record_notification_media_deduplicates_identical_media() {
    let record = NotificationRecord {
        media: vec![
            media("123", "https://www.instagram.com/p/ABC123/"),
            media("123", "https://www.instagram.com/p/ABC123/"),
        ],
        ..record()
    };

    assert_eq!(
        record.arguments().unwrap()["p_media"],
        json!([{"media_id": "123", "source_url": "https://www.instagram.com/p/ABC123/"}])
    );
}

#[test]
fn test_record_notification_media_records_empty_materialization() {
    let record = NotificationRecord {
        cache_ent_id: Some("   ".into()),
        media: vec![],
        ..record()
    };

    let arguments = record.arguments().unwrap();
    assert_eq!(arguments["p_cache_ent_id"], serde_json::Value::Null);
    assert_eq!(arguments["p_media"], json!([]));
}

#[test]
fn test_record_notification_media_rejects_conflicting_duplicate_urls() {
    let record = NotificationRecord {
        media: vec![
            media("123", "https://www.instagram.com/p/ABC123/"),
            media("123", "https://www.instagram.com/p/DIFFERENT/"),
        ],
        ..record()
    };

    let error = record.arguments().unwrap_err();
    assert!(
        error.to_string().contains("multiple source URLs"),
        "{error}"
    );
    assert!(matches!(
        error.downcast_ref::<BrowserError>(),
        Some(BrowserError::Value(_))
    ));
}
