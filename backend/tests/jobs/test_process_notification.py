import json
import logging
from types import SimpleNamespace

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
    claim_calls = []
    next_index = 0

    def record(**kwargs):
        record_calls.append(kwargs)
        return "notification-1"

    def claim_next(**kwargs):
        nonlocal next_index
        claim_calls.append(kwargs)
        media = record_calls[0]["media"]
        if next_index >= len(media):
            return None
        next_index += 1
        return _claim_for(media[next_index - 1], next_index)

    monkeypatch.setattr(process_notification, "record_notification_media", record)
    monkeypatch.setattr(process_notification, "claim_next_notification_media", claim_next)
    return record_calls, claim_calls


def _install_digest_resolver(monkeypatch, media_ids: tuple[str, ...]):
    calls = []

    class _Resolver:
        def resolve(self, intended_recipient_id: str, cache_ent_id: str):
            calls.append((intended_recipient_id, cache_ent_id))
            return DigestResolution(
                account_username="ubc.wat2do.io",
                media_ids=media_ids,
                page_count=1,
            )

    monkeypatch.setattr(process_notification, "BrowserInstagramDigestResolver", _Resolver)
    return calls


def test_media_notification_processes_ordered_unique_exact_claims(monkeypatch) -> None:
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
    record_calls, claim_calls = _capture_ledger(monkeypatch)
    scrape_calls = []
    success_calls = []
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **kwargs: scrape_calls.append(kwargs) or 0,
    )
    monkeypatch.setattr(
        process_notification,
        "mark_media_succeeded",
        lambda **kwargs: success_calls.append(kwargs) or True,
    )

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
    assert claim_calls == [
        {"notification_id": "notification-1", "github_run_id": "31759739105"},
        {"notification_id": "notification-1", "github_run_id": "31759739105"},
        {"notification_id": "notification-1", "github_run_id": "31759739105"},
    ]
    assert [call["targets"] for call in scrape_calls] == [[url] for url in expected_urls]
    assert success_calls == [
        {"media_row_id": "media-row-1", "claim_token": "claim-1"},
        {"media_row_id": "media-row-2", "claim_token": "claim-2"},
    ]


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
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    monkeypatch.setattr(process_notification, "run", lambda **_kwargs: 0)
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    with caplog.at_level(logging.INFO):
        assert process_notification.main() == 0

    assert [item.media_id for item in record_calls[0]["media"]] == [
        first_media_id,
        second_media_id,
        third_media_id,
        fourth_media_id,
    ]
    assert resolver_calls == [(RECIPIENT_ID, "cache-123")]
    assert record_calls[0]["cache_ent_id"] == "cache-123"
    assert record_calls[0]["total_non_mmc_media_count"] == 4
    assert "Expanded Instagram digest through ubc.wat2do.io to 4 exact media target" in (
        caplog.text
    )


def test_duplicate_delivery_with_no_claims_does_not_scrape(monkeypatch) -> None:
    _set_payload(monkeypatch, _actionable_payload("clips_home?media_id=123456789"))
    _install_school(monkeypatch)
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: "notification-1",
    )
    monkeypatch.setattr(
        process_notification,
        "claim_next_notification_media",
        lambda **_kwargs: None,
    )
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("scrape should not run")),
    )

    assert process_notification.main() == 0


def test_each_media_is_claimed_only_immediately_before_its_scrape(monkeypatch) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload("clips_home?media_list=123456789,987654321"),
    )
    _install_school(monkeypatch)
    recorded_media = []
    events = []
    next_index = 0

    def record(**kwargs):
        recorded_media.extend(kwargs["media"])
        return "notification-1"

    def claim_next(**_kwargs):
        nonlocal next_index
        if next_index == len(recorded_media):
            events.append("claim-none")
            return None
        next_index += 1
        events.append(f"claim-{next_index}")
        return _claim_for(recorded_media[next_index - 1], next_index)

    monkeypatch.setattr(process_notification, "record_notification_media", record)
    monkeypatch.setattr(process_notification, "claim_next_notification_media", claim_next)
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **_kwargs: events.append(f"scrape-{next_index}") or 0,
    )
    monkeypatch.setattr(
        process_notification,
        "mark_media_succeeded",
        lambda **_kwargs: events.append(f"finalize-{next_index}") or True,
    )

    assert process_notification.main() == 0
    assert events == [
        "claim-1",
        "scrape-1",
        "finalize-1",
        "claim-2",
        "scrape-2",
        "finalize-2",
        "claim-none",
    ]


def test_incomplete_digest_is_recorded_and_processes_explicit_media(
    monkeypatch,
    caplog,
) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload("clips_home?media_id=123456789&total_non_mmc_media_count=4"),
    )
    _install_school(monkeypatch)
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    monkeypatch.setattr(process_notification, "run", lambda **_kwargs: 0)
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    with caplog.at_level(logging.WARNING):
        assert process_notification.main() == 0

    assert "exposed 1 of 4 advertised media items" in caplog.text
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
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("scrape should not run")),
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
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("scrape should not run")),
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
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    monkeypatch.setattr(process_notification, "run", lambda **_kwargs: 0)
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

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
            "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=2",
        ),
    )
    _install_school(monkeypatch)

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


def test_digest_count_mismatch_stops_before_ledger_recording(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789&cache_ent_id=cache-123&total_non_mmc_media_count=3",
        ),
    )
    _install_school(monkeypatch)
    _install_digest_resolver(monkeypatch, ("987654321",))
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("ledger should not run")),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "did not resolve the advertised number" in caplog.text


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


def test_scrape_failure_is_terminal_and_other_claims_continue(monkeypatch) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload("clips_home?media_list=123456789,987654321"),
    )
    _install_school(monkeypatch)
    _capture_ledger(monkeypatch)
    statuses = iter((1, 0))
    scrape_calls = []
    failed_calls = []
    succeeded_calls = []
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **kwargs: scrape_calls.append(kwargs) or next(statuses),
    )
    monkeypatch.setattr(
        process_notification,
        "mark_media_failed",
        lambda **kwargs: failed_calls.append(kwargs) or True,
    )
    monkeypatch.setattr(
        process_notification,
        "mark_media_succeeded",
        lambda **kwargs: succeeded_calls.append(kwargs) or True,
    )

    assert process_notification.main() == 1

    assert len(scrape_calls) == 2
    assert failed_calls == [
        {
            "media_row_id": "media-row-1",
            "claim_token": "claim-1",
            "failure_category": "scrape_error",
        }
    ]
    assert succeeded_calls == [{"media_row_id": "media-row-2", "claim_token": "claim-2"}]


def test_non_object_notification_json_fails(monkeypatch, caplog) -> None:
    _set_payload(monkeypatch, ["not", "an", "object"])

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "must contain a JSON object" in caplog.text
