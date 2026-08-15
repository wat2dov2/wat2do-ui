import json
import logging
from types import SimpleNamespace

from jobs import process_notification
from services.instagram_digest.client import DigestResult
from services.instagram_digest.ledger import MediaClaim
from services.instagram_digest.sessions import SessionHealthStatus, SessionStoreError

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


def test_digest_merges_explicit_and_paginated_media_in_stable_order(monkeypatch) -> None:
    explicit_id = "123456789"
    continuation_id = "987654321"
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_list={explicit_id}_1&cache_ent_id=cache-123&"
            "total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    monkeypatch.setattr(
        process_notification.KeychainSessionStore,
        "load",
        lambda _self, recipient_id: SimpleNamespace(recipient=recipient_id),
    )
    monkeypatch.setattr(
        process_notification.KeychainSessionStore,
        "store",
        lambda _self, session: None,
    )

    class FakeDigestClient:
        def __init__(self, session, **kwargs):
            assert session.recipient == RECIPIENT_ID
            assert kwargs["operation_name"] == "SubscriptionDigestFeedQuery"
            assert kwargs["web_app_id"] == "936619743392459"

        def fetch_media(self, cache_ent_id):
            assert cache_ent_id == "cache-123"
            return DigestResult(
                media=(
                    {"pk": explicit_id, "id": f"{explicit_id}_44"},
                    {"pk": int(continuation_id)},
                ),
                page_count=2,
                session=SimpleNamespace(intended_recipient_id=RECIPIENT_ID),
            )

    monkeypatch.setattr(process_notification, "InstagramDigestClient", FakeDigestClient)
    monkeypatch.setattr(process_notification, "run", lambda **_kwargs: 0)
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    assert process_notification.main() == 0

    assert [item.media_id for item in record_calls[0]["media"]] == [
        explicit_id,
        continuation_id,
    ]
    assert record_calls[0]["cache_ent_id"] == "cache-123"
    assert record_calls[0]["total_non_mmc_media_count"] == 2


def test_complete_explicit_digest_skips_session_expansion(monkeypatch) -> None:
    first_media_id = "123456789"
    second_media_id = "987654321"
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_list={first_media_id},{second_media_id}&cache_ent_id=cache-123&"
            "total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    monkeypatch.setattr(
        process_notification.KeychainSessionStore,
        "load",
        lambda _self, _recipient_id: (_ for _ in ()).throw(
            AssertionError("complete explicit media must not load a session")
        ),
    )
    monkeypatch.setattr(process_notification, "run", lambda **_kwargs: 0)
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    assert process_notification.main() == 0

    assert [item.media_id for item in record_calls[0]["media"]] == [
        first_media_id,
        second_media_id,
    ]


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


def test_incomplete_digest_is_recorded_and_reported_honestly(
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

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "advertised=4 materialized=1" in caplog.text
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


def test_actionable_digest_without_recoverable_media_fails(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?total_non_mmc_media_count=4",
        ),
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "no recoverable Instagram media" in caplog.text


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


def test_digest_session_failure_writes_sanitized_school_report(
    monkeypatch,
    caplog,
    tmp_path,
) -> None:
    sensitive_marker = "secret-upstream-detail"
    _set_payload(
        monkeypatch,
        _actionable_payload("clips_home?cache_ent_id=cache-123"),
    )
    _install_school(monkeypatch)
    report_path = tmp_path / "session-failure.json"
    monkeypatch.setenv("SESSION_FAILURE_REPORT_PATH", str(report_path))

    def fail_load(_self, _recipient_id):
        raise SessionStoreError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            sensitive_marker,
        )

    monkeypatch.setattr(process_notification.KeychainSessionStore, "load", fail_load)

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "school=ubc status=reauthorization_required" in caplog.text
    assert sensitive_marker not in caplog.text
    report_text = report_path.read_text(encoding="utf-8")
    report = json.loads(report_text)
    assert report == {
        "healthy": False,
        "issues": [],
        "sessions": [
            {
                "account_username": None,
                "intended_recipient_id": RECIPIENT_ID,
                "issue": "invalid_session",
                "school": "ubc",
                "status": "reauthorization_required",
            }
        ],
    }
    assert sensitive_marker not in report_text


def test_digest_session_failure_processes_explicit_media_before_failing(
    monkeypatch,
    caplog,
    tmp_path,
) -> None:
    explicit_media_id = "123456789"
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_id={explicit_media_id}&cache_ent_id=cache-123&"
            "total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    report_path = tmp_path / "session-failure.json"
    monkeypatch.setenv("SESSION_FAILURE_REPORT_PATH", str(report_path))
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    scrape_calls = []

    def fail_load(_self, _recipient_id):
        raise SessionStoreError(SessionHealthStatus.MISSING, "sensitive detail")

    monkeypatch.setattr(process_notification.KeychainSessionStore, "load", fail_load)
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **kwargs: scrape_calls.append(kwargs) or 0,
    )
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert [item.media_id for item in record_calls[0]["media"]] == [explicit_media_id]
    assert [call["targets"] for call in scrape_calls] == [[record_calls[0]["media"][0].source_url]]
    assert "school=ubc status=missing" in caplog.text
    assert "advertised=2 materialized=1" in caplog.text
    assert "sensitive detail" not in caplog.text
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["sessions"][0]["issue"] == "missing_session"


def test_digest_session_failure_without_total_does_not_record_partial_media(
    monkeypatch,
) -> None:
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?media_id=123456789&cache_ent_id=cache-123",
        ),
    )
    _install_school(monkeypatch)

    def fail_load(_self, _recipient_id):
        raise SessionStoreError(SessionHealthStatus.MISSING, "sensitive detail")

    monkeypatch.setattr(process_notification.KeychainSessionStore, "load", fail_load)
    monkeypatch.setattr(
        process_notification,
        "record_notification_media",
        lambda **_kwargs: (_ for _ in ()).throw(
            AssertionError("unknown partial media must not be recorded as complete")
        ),
    )

    assert process_notification.main() == 1


def test_digest_session_persistence_failure_keeps_materialized_media(
    monkeypatch,
    caplog,
    tmp_path,
) -> None:
    explicit_media_id = "123456789"
    continuation_media_id = "987654321"
    _set_payload(
        monkeypatch,
        _actionable_payload(
            "clips_home?"
            f"media_id={explicit_media_id}&cache_ent_id=cache-123&"
            "total_non_mmc_media_count=2"
        ),
    )
    _install_school(monkeypatch)
    report_path = tmp_path / "session-failure.json"
    monkeypatch.setenv("SESSION_FAILURE_REPORT_PATH", str(report_path))
    record_calls, _claim_calls = _capture_ledger(monkeypatch)
    scrape_calls = []
    monkeypatch.setattr(
        process_notification.KeychainSessionStore,
        "load",
        lambda _self, recipient_id: SimpleNamespace(recipient=recipient_id),
    )

    digest_result = DigestResult(
        media=({"pk": continuation_media_id},),
        page_count=2,
        session=SimpleNamespace(intended_recipient_id=RECIPIENT_ID),
    )
    monkeypatch.setattr(
        process_notification,
        "InstagramDigestClient",
        lambda *_args, **_kwargs: SimpleNamespace(fetch_media=lambda _cache_ent_id: digest_result),
    )

    def fail_store(_self, _session):
        raise SessionStoreError(SessionHealthStatus.TRANSIENT_ERROR, "sensitive detail")

    monkeypatch.setattr(process_notification.KeychainSessionStore, "store", fail_store)
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **kwargs: scrape_calls.append(kwargs) or 0,
    )
    monkeypatch.setattr(process_notification, "mark_media_succeeded", lambda **_kwargs: True)

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert [item.media_id for item in record_calls[0]["media"]] == [
        explicit_media_id,
        continuation_media_id,
    ]
    assert len(scrape_calls) == 2
    assert "school=ubc status=transient_error" in caplog.text
    assert "materialization is incomplete" not in caplog.text
    assert "sensitive detail" not in caplog.text
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["sessions"][0]["issue"] == "persistence_failed"


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
