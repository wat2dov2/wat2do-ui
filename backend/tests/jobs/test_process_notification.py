import json
import logging

from jobs import process_notification


def _set_payload(monkeypatch, payload: object) -> None:
    monkeypatch.setenv("NOTIFICATION_JSON", json.dumps(payload))
    monkeypatch.setenv("CUTOFF_DAYS", "1")


def test_media_notification_dispatches_ordered_unique_exact_urls(monkeypatch) -> None:
    first_media_id = 123456789
    second_media_id = 987654321
    _set_payload(
        monkeypatch,
        {
            "com.instagram.android.igns.logging.ig_action": (
                "clips_home?"
                f"media_list={first_media_id}_1,{first_media_id}_2&media_id={second_media_id}_3"
            )
        },
    )
    calls = []
    monkeypatch.setattr(
        process_notification,
        "run",
        lambda **kwargs: calls.append(kwargs) or 0,
    )

    assert process_notification.main() == 0
    assert calls == [
        {
            "targets": [
                "https://www.instagram.com/p/"
                f"{process_notification.get_shortcode_from_media_id(first_media_id)}/",
                "https://www.instagram.com/p/"
                f"{process_notification.get_shortcode_from_media_id(second_media_id)}/",
            ],
            "cutoff_days": 1,
            "dry_run": False,
            "allow_past_events": False,
        }
    ]


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

    assert "suggested_close_friend" in caplog.text
    assert "action='user'" in caplog.text
    assert sensitive_marker not in caplog.text
    assert "suggested_account" not in caplog.text


def test_invalid_media_notification_fails_without_logging_identifier(
    monkeypatch,
    caplog,
) -> None:
    sensitive_marker = "invalid-secret-media-id"
    _set_payload(
        monkeypatch,
        {
            "com.instagram.android.igns.logging.ig_action": (
                f"clips_home?media_id={sensitive_marker}"
            )
        },
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "invalid media ID" in caplog.text
    assert sensitive_marker not in caplog.text


def test_digest_without_materialized_media_fails(monkeypatch, caplog) -> None:
    _set_payload(
        monkeypatch,
        {
            "com.instagram.android.igns.logging.ig_action": (
                "clips_home?cache_ent_id=123&total_non_mmc_media_count=12"
            )
        },
    )

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "digest notification did not expose materialized media IDs" in caplog.text


def test_non_object_notification_json_fails(monkeypatch, caplog) -> None:
    _set_payload(monkeypatch, ["not", "an", "object"])

    with caplog.at_level(logging.ERROR):
        assert process_notification.main() == 1

    assert "must contain a JSON object" in caplog.text
