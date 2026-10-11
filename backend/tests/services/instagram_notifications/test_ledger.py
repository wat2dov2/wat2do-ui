import pytest

from services.instagram_notifications import ledger


def _record(**overrides):
    defaults = {
        "school_id": 7,
        "intended_recipient_id": "76214170483",
        "push_id": "push-123",
        "push_category": "subscription_daily_digest",
        "cache_ent_id": "cache-456",
        "total_non_mmc_media_count": 3,
        "media": [
            ledger.MaterializedMedia(
                media_id="3701234567890123456",
                source_url="https://www.instagram.com/p/ABC123/",
            ),
            ledger.MaterializedMedia(
                media_id="3701234567890123457",
                source_url="https://www.instagram.com/p/ABC124/",
            ),
        ],
    }
    defaults.update(overrides)
    return ledger.record_notification_media(**defaults)


def test_record_notification_media_records_metadata_and_returns_id(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=[{"notification_id": "notification-1", "newly_inserted_count": 0}])

    assert _record() == ("notification-1", 0)
    fake_sb.rpc.assert_called_once_with(
        "record_instagram_notification_media",
        {
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
        },
    )


def test_record_notification_media_deduplicates_identical_media(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=[{"notification_id": "notification-1", "newly_inserted_count": 1}])

    result = _record(
        media=[
            ledger.MaterializedMedia("123", "https://www.instagram.com/p/ABC123/"),
            ledger.MaterializedMedia("123", "https://www.instagram.com/p/ABC123/"),
        ]
    )

    assert result == ("notification-1", 1)
    params = fake_sb.rpc.call_args.args[1]
    assert params["p_media"] == [
        {"media_id": "123", "source_url": "https://www.instagram.com/p/ABC123/"}
    ]


def test_record_notification_media_records_empty_materialization(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=[{"notification_id": "notification-1", "newly_inserted_count": 0}])

    assert _record(cache_ent_id="   ", media=[]) == ("notification-1", 0)
    params = fake_sb.rpc.call_args.args[1]
    assert params["p_cache_ent_id"] is None
    assert params["p_media"] == []


def test_record_notification_media_rejects_conflicting_duplicate_urls(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")

    with pytest.raises(ValueError, match="multiple source URLs"):
        _record(
            media=[
                ledger.MaterializedMedia("123", "https://www.instagram.com/p/ABC123/"),
                ledger.MaterializedMedia("123", "https://www.instagram.com/p/DIFFERENT/"),
            ]
        )

    fake_sb.rpc.assert_not_called()
