import json
import logging
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

# Mock fcntl for Windows test runs so we don't get "No module named 'fcntl'"
if sys.platform == "win32":
    sys.modules["fcntl"] = MagicMock()

from jobs import process_notification
from services.instagram_notifications.browser_digest import DigestResolution
from services.instagram_notifications.ledger import MediaClaim

RECIPIENT_ID = "12342599092"
PUSH_ID = "push-123"
PUSH_CATEGORY = "subscription_daily_digest"


def _set_payload(monkeypatch, payload: object) -> None:
    monkeypatch.setenv("NOTIFICATION_JSON", json.dumps(payload))
    monkeypatch.setenv("CUTOFF_DAYS", "1")
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", RECIPIENT_ID)
    monkeypatch.setenv("GITHUB_RUN_ID", "31759739105")


def _actionable_payload(action: str, **extra: object) -> dict[str, object]:
    return {
        "android.subText": "ubc.wat2do.io",
        "com.instagram.android.igns.logging.ig_action": action,
        "com.instagram.android.igns.logging.push_category": PUSH_CATEGORY,
        "com.instagram.android.igns.logging.push_id": PUSH_ID,
        "com.instagram.android.igns.logging.intended_recipient_id": RECIPIENT_ID,
        **extra,
    }


def _install_school(monkeypatch) -> None:
    monkeypatch.setattr(
        process_notification.school_service,
        "get_school_by_recipient_id",
        lambda recipient_id: (
            SimpleNamespace(id=7, slug="ubc") if recipient_id == RECIPIENT_ID else None
        ),
    )


def _claim_for(item, index: int) -> MediaClaim:
    return MediaClaim(
        media_row_id=f"media-row-{index}",
        source_url=item.source_url,
        claim_token=f"claim-{index}",
    )


def _capture_ledger(monkeypatch):
    record_calls = []

    def record(**kwargs):
        record_calls.append(kwargs)
        return "notification-1", len(kwargs.get("media", []))

    monkeypatch.setattr(process_notification, "record_notification_media", record)
    return record_calls


def _install_digest_resolver(monkeypatch, media_ids: tuple[str, ...]):
    calls = []

    class _Resolver:
        def resolve(
            self,
            intended_recipient_id: str,
            account_username: str,
            cache_ent_id: str,
        ):
            calls.append((intended_recipient_id, account_username, cache_ent_id))
            return DigestResolution(
                account_username="ubc.wat2do.io",
                media_ids=media_ids,
                page_count=1,
            )

    monkeypatch.setattr(process_notification, "BrowserInstagramDigestResolver", _Resolver)
    import sys

    monkeypatch.setattr(sys, "platform", "darwin")
    return calls


def test_media_notification_records_ordered_unique_exact_claims(monkeypatch) -> None:
    first_media_id = 123456789
    second_media_id = 987654321
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_list={first_media_id}_1,{first_media_id}_2&media_id={second_media_id}_3"
        ),
    )
    _install_school(monkeypatch)
    record_calls = _capture_ledger(monkeypatch)

    assert process_notification.main() == 0

    expected_urls = [
        "https://www.instagram.com/p/"
        f"{process_notification.get_shortcode_from_media_id(first_media_id)}/",
        "https://www.instagram.com/p/"
        f"{process_notification.get_shortcode_from_media_id(second_media_id)}/",
    ]
    assert [item.source_url for item in record_calls[0]["media"]] == expected_urls
    assert record_calls[0]["school_id"] == 7
    assert record_calls[0]["intended_recipient_id"] == RECIPIENT_ID
    assert record_calls[0]["push_id"] == PUSH_ID


def test_digest_expands_hidden_media_before_recording_and_keeps_metadata(
    monkeypatch,
    caplog,
) -> None:
    first_media_id = "123456789"
    second_media_id = "987654321"
    third_media_id = "111111111"
    fourth_media_id = "222222222"
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_list={first_media_id}_1,{second_media_id}_2&cache_ent_id=cache-123&"
            "total_non_mmc_media_count=4"
        ),
    )
    _install_school(monkeypatch)
    resolver_calls = _install_digest_resolver(
        monkeypatch,
        (third_media_id, fourth_media_id),
    )
    record_calls = _capture_ledger(monkeypatch)
    with caplog.at_level(logging.INFO):
        assert process_notification.main() == 0

    assert [item.media_id for item in record_calls[0]["media"]] == [
        first_media_id,
        second_media_id,
        third_media_id,
        fourth_media_id,
    ]
    assert resolver_calls == [(RECIPIENT_ID, "ubc.wat2do.io", "cache-123")]
    assert record_calls[0]["cache_ent_id"] == "cache-123"
    assert record_calls[0]["total_non_mmc_media_count"] == 4
    assert "Expanded Instagram digest through ubc.wat2do.io to 4 exact media target" in (
        caplog.text
    )


def test_incomplete_digest_is_recorded_and_processes_explicit_media(
    monkeypatch,
    caplog,
) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload("clips_home?media_id=123456789&total_non_mmc_media_count=4"),
    )
    _install_school(monkeypatch)
    record_calls = _capture_ledger(monkeypatch)
    with caplog.at_level(logging.WARNING):
        assert process_notification.main() == 0

    assert "returned 1 of 4 advertised media items" in caplog.text
    assert record_calls[0]["total_non_mmc_media_count"] == 4


def test_unrelated_notification_is_a_sanitized_noop(monkeypatch, caplog) -> None:
    sensitive_marker = "must-never-reach-logs"
    _set_payload(
        monkeypatch,
        {
            "com.instagram.android.igns.logging.push_category": "suggested_close_friend",
            "com.instagram.android.igns.logging.ig_action": "user?username=suggested_account",
            "android.text": sensitive_marker,
        },
    )
    with caplog.at_level(logging.INFO):
        assert process_notification.main() == 0

    assert "Ignoring unsupported Instagram notification" in caplog.text
    assert sensitive_marker not in caplog.text
    assert "suggested_account" not in caplog.text


def test_unrelated_notification_with_media_shape_is_a_noop(monkeypatch) -> None:
    payload = _actionable_payload("clips_home?media_id=not-a-media-id")
    payload["com.instagram.android.igns.logging.push_category"] = "suggested_close_friend"
    _set_payload(
        monkeypatch,
        payload,
    )
    assert process_notification.main() == 0


def test_cache_only_digest_is_expanded_before_validation(monkeypatch) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?cache_ent_id=cache-123&total_non_mmc_media_count=2",
        ),
    )
    _install_school(monkeypatch)
    _install_digest_resolver(monkeypatch, ("123456789", "987654321"))
    record_calls = _capture_ledger(monkeypatch)
    assert process_notification.main() == 0
    assert [item.media_id for item in record_calls[0]["media"]] == [
        "123456789",
        "987654321",
    ]


def test_digest_resolution_failure_stops_before_ledger_recording(
    monkeypatch,
    caplog,
) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    import sys

    monkeypatch.setattr(sys, "platform", "darwin")

    class _Resolver:
        def resolve(self, *_args):
            raise process_notification.BrowserDigestError("sanitized browser failure")

    monkeypatch.setattr(process_notification, "BrowserInstagramDigestResolver", _Resolver)
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("ledger should not run")),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "sanitized browser failure" in caplog.text


def test_cache_digest_requires_browser_capable_runner(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("ledger should not run")),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "requires the browser-capable Mac runner" in caplog.text


def test_terminal_digest_shortfall_processes_every_available_media(
    monkeypatch,
    caplog,
) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=3",
        ),
    )
    _install_school(monkeypatch)
    _install_digest_resolver(monkeypatch, ("987654321",))
    import sys

    monkeypatch.setattr(sys, "platform", "darwin")
    record_calls = _capture_ledger(monkeypatch)
    with caplog.at_level(logging.WARNING):
        assert process_notification.main() == 0

    assert [item.media_id for item in record_calls[0]["media"]] == [
        "123456789",
        "987654321",
    ]
    assert "returned 2 of 3 advertised media items" in caplog.text


def test_digest_over_count_stops_before_ledger_recording(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_list=123456789,987654321&cache_ent_id=cache-123&total_non_mmc_media_count=1"
        ),
    )
    _install_school(monkeypatch)
    import sys

    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("ledger should not run")),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "resolved more media IDs than advertised" in caplog.text


def test_invalid_media_notification_fails_without_logging_identifier(
    monkeypatch,
    caplog,
) -> None:
    sensitive_marker = "invalid-secret-media-id"
    _set_payload(
        monkeypatch,
        _actionable_payload(f"clips_home?media_id={sensitive_marker}"),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "invalid media ID" in caplog.text
    assert sensitive_marker not in caplog.text


def test_actionable_notification_requires_push_id(monkeypatch, caplog) -> None:
    payload = _actionable_payload("clips_home?media_id=123456789")
    del payload["com.instagram.android.igns.logging.push_id"]
    _set_payload(monkeypatch, payload)

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "requires a valid push ID" in caplog.text


def test_payload_recipient_must_match_workflow_routing(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789",
            **{"com.instagram.android.igns.logging.intended_recipient_id": "99999999999"},
        ),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "does not match workflow routing" in caplog.text


def test_workflow_recipient_must_be_canonical(monkeypatch, caplog) -> None:
    _set_payload(monkeypatch, _actionable_payload("clips_home?media_id=123456789"))
    monkeypatch.setenv("INTENDED_RECIPIENT_ID", f"0{RECIPIENT_ID}")

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "valid intended recipient ID" in caplog.text


def test_non_object_notification_json_fails(monkeypatch, caplog) -> None:
    _set_payload(monkeypatch, ["not", "an", "object"])

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "must contain a JSON object" in caplog.text
