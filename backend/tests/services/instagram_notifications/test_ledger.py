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
    fake_sb.set_response(data="notification-1")

    assert _record() == "notification-1"
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
    fake_sb.set_response(data="notification-1")

    result = _record(
        media=[
            ledger.MaterializedMedia("123", "https://www.instagram.com/p/ABC123/"),
            ledger.MaterializedMedia("123", "https://www.instagram.com/p/ABC123/"),
        ]
    )

    assert result == "notification-1"
    params = fake_sb.rpc.call_args.args[1]
    assert params["p_media"] == [
        {"media_id": "123", "source_url": "https://www.instagram.com/p/ABC123/"}
    ]


def test_record_notification_media_records_empty_materialization(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data="notification-1")

    assert _record(cache_ent_id="   ", media=[]) == "notification-1"
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


def test_claim_next_notification_media_returns_one_irreversible_claim(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(
        data=[
            {
                "media_row_id": "media-row-1",
                "source_url": "https://www.instagram.com/p/ABC123/",
                "claim_token": "claim-1",
                "intended_recipient_id": "76214170483",
            }
        ]
    )

    assert ledger.claim_next_notification_media(
        notification_id="notification-1",
        github_run_id="31756592543",
    ) == ledger.MediaClaim(
        media_row_id="media-row-1",
        source_url="https://www.instagram.com/p/ABC123/",
        claim_token="claim-1",
        intended_recipient_id="76214170483",
    )
    fake_sb.rpc.assert_called_once_with(
        "claim_next_instagram_notification_media",
        {
            "p_notification_id": "notification-1",
            "p_github_run_id": "31756592543",
        },
    )


def test_claim_next_notification_media_returns_none_when_no_pending_rows(
    fake_sb,
    patch_sb,
):
    patch_sb("services.instagram_notifications.ledger")

    assert (
        ledger.claim_next_notification_media(
            notification_id="notification-1",
            github_run_id=None,
        )
        is None
    )


def test_mark_media_succeeded_uses_token_guarded_rpc(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=True)

    assert ledger.mark_media_succeeded(media_row_id="media-row-1", claim_token="claim-1")
    fake_sb.rpc.assert_called_once_with(
        "finalize_instagram_notification_media",
        {
            "p_media_row_id": "media-row-1",
            "p_claim_token": "claim-1",
            "p_status": "succeeded",
            "p_failure_category": None,
        },
    )


def test_mark_media_failed_sends_only_sanitized_category(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=True)

    assert ledger.mark_media_failed(
        media_row_id="media-row-1",
        claim_token="claim-1",
        failure_category=" provider_timeout ",
    )
    fake_sb.rpc.assert_called_once_with(
        "finalize_instagram_notification_media",
        {
            "p_media_row_id": "media-row-1",
            "p_claim_token": "claim-1",
            "p_status": "failed",
            "p_failure_category": "provider_timeout",
        },
    )


def test_finalization_returns_false_after_claim_is_lost(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")
    fake_sb.set_response(data=False)

    assert not ledger.mark_media_succeeded(
        media_row_id="media-row-1",
        claim_token="stale-claim",
    )


def test_mark_media_failed_rejects_empty_category(fake_sb, patch_sb):
    patch_sb("services.instagram_notifications.ledger")

    with pytest.raises(ValueError, match="cannot be empty"):
        ledger.mark_media_failed(
            media_row_id="media-row-1",
            claim_token="claim-1",
            failure_category="   ",
        )

    fake_sb.rpc.assert_not_called()
