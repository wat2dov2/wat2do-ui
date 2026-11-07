from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from botocore.exceptions import ClientError, ReadTimeoutError  # type: ignore[import-untyped]

from core.config import settings
from core.constants import (
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)
from schemas.event import EventResponse
from services.notifications import (
    delivery_log,
    event_change,
    preferences,
    rendering,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


def _event(**overrides) -> dict:
    defaults = {
        "id": 42,
        "title": "Tea Tasting",
        "location": "SLC",
        "dtstart_utc": "2026-05-01T15:00:00+00:00",
        "added_at": "2026-05-01T12:00:00+00:00",
    }
    defaults.update(overrides)
    return defaults


def test_morning_email_reaches_everyone_who_has_not_turned_it_off(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    fake_sb.set_response(data=[])
    assert preferences.get_enabled_user_ids([USER_ID], NOTIFICATION_TYPE_MORNING_EMAIL) == {USER_ID}
    fake_sb.set_response(data=[{"user_id": USER_ID, "enabled": False}])
    assert preferences.get_enabled_user_ids([USER_ID], NOTIFICATION_TYPE_MORNING_EMAIL) == set()


def test_claim_delivery_returns_only_claimed_rows(fake_sb, patch_sb):
    patch_sb("services.notifications.delivery_log")
    fake_sb.set_response(data=[{"id": "row-1", "claimed": True}])

    assert (
        delivery_log.claim_delivery(
            user_id=USER_ID,
            notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
            target_id="2026-05-01",
        )
        == "row-1"
    )
    fake_sb.rpc.assert_called_once()

    fake_sb.set_response(data=[{"id": "row-1", "claimed": False}])
    assert (
        delivery_log.claim_delivery(
            user_id=USER_ID,
            notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
            target_id="2026-05-01",
        )
        is None
    )


def test_event_change_empty_diff_is_noop():
    assert event_change.enqueue_event_change(None, {}, []) == 0


def _change_email(diff, image_src=None, refund_url=None, **event_fields):
    args = {
        "subject": "Changed: Tea Tasting",
        "event": _event(**event_fields),
        "diff": diff,
        "image_src": image_src,
        "tz": ZoneInfo("America/Toronto"),
        "frontend_url": "https://uwaterloo.wat2do.io",
        "preferences_url": "https://uwaterloo.wat2do.io/settings",
        "unsubscribe_url": "https://uwaterloo.wat2do.io/unsubscribe",
        "refund_url": refund_url,
    }
    html = rendering.render_event_change_html(**args)
    del args["image_src"]
    return html, rendering.render_event_change_text(**args)


def _date(start: str, end: str | None = None) -> dict:
    return {"dtstart_utc": start, "dtend_utc": end, "duration": None, "tz": None}


def test_event_change_email_reads_each_change_in_local_time():
    html, text = _change_email(
        {
            "location": {"old": "RCH 208", "new": "DC 1301"},
            "occurrences": {
                "old": [
                    _date("2026-11-02T18:00:00+00:00", "2026-11-02T21:00:00+00:00"),
                    _date("2026-11-16T18:00:00+00:00"),
                ],
                "new": [
                    _date("2026-11-02T20:00:00+00:00", "2026-11-02T22:00:00+00:00"),
                    _date("2026-11-23T18:00:00+00:00"),
                ],
            },
        },
        image_src="cid:event-image",
    )

    assert text.splitlines()[2:7] == [
        "You're going to this event. Here's what changed:",
        "",
        "- Location: RCH 208 -> DC 1301",
        "- Mon, Nov 2: 1 PM - 4 PM -> 3 PM - 5 PM",
        "- Removed date: Mon, Nov 16, 1 PM (removed)",
    ]
    assert "- Added date: Mon, Nov 23, 1 PM" in text
    assert "View the event: https://uwaterloo.wat2do.io/events/42" in text
    assert '<img src="cid:event-image"' in html
    assert '<img src="cid:wat2do-logo" alt="wat2do"' in html
    assert html.count('href="https://uwaterloo.wat2do.io/events/42"') == 3
    assert 'text-decoration:line-through;">RCH 208</span> &rarr; <strong>DC 1301</strong>' in html
    assert "Location: " not in html


def test_event_change_email_leads_with_cancellation_and_escapes_values():
    html, _text = _change_email(
        {"cancelled": {"old": False, "new": True}},
        title="<b>Night</b>",
    )

    assert rendering.event_change_subject(_event(), {"cancelled": {"new": True}}) == (
        "Cancelled: Tea Tasting"
    )
    assert rendering.event_change_subject(_event(), {"location": {}}) == "Changed: Tea Tasting"
    assert "<strong>Cancelled</strong>" in html
    assert "&lt;b&gt;Night&lt;/b&gt;" in html
    assert "event-image" not in html


def test_event_change_rendering_failure_claims_no_delivery(monkeypatch):
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "")
    claim = MagicMock()
    monkeypatch.setattr(event_change, "claim_delivery", claim)

    with pytest.raises(RuntimeError, match="EMAIL_UNSUBSCRIBE_SECRET"):
        event_change._send_event_change(
            user_id=str(USER_ID),
            email="student@uwaterloo.ca",
            event_summary=_event(school="uwaterloo"),
            diff={"location": {"old": "SLC", "new": "DC"}},
            image=None,
            target_id="42:abc",
            refund_url=None,
        )
    claim.assert_not_called()


def test_event_change_email_offers_a_paid_holder_a_refund():
    refund = "https://uwaterloo.wat2do.io/tickets/AAAABBBBCCCCDDDDEEEEFFFF?refund=1"
    html, text = _change_email({"location": {"old": "SLC", "new": "DC"}}, refund_url=refund)
    assert rendering.REFUND_OFFER in text
    assert f"Request a refund: {refund}" in text
    assert f'href="{refund}"' in html
    _html, plain = _change_email({"location": {"old": "SLC", "new": "DC"}})
    assert rendering.REFUND_OFFER not in plain


def test_only_a_new_time_or_place_offers_a_refund():
    assert event_change._offers_refund({"location": {"old": "SLC", "new": "DC"}})
    assert event_change._offers_refund({"occurrences": {"old": [], "new": []}})
    assert not event_change._offers_refund({"title": {"old": "A", "new": "B"}})
    # A cancellation refunds every ticket by itself.
    assert not event_change._offers_refund(
        {"cancelled": {"old": False, "new": True}, "location": {"old": "SLC", "new": "DC"}}
    )


def test_refund_links_open_one_ticket_or_all_of_them(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.notifications.event_change")
    monkeypatch.setattr(
        event_change, "school_frontend_url", lambda school: "https://uwaterloo.wat2do.io"
    )
    fake_sb.set_response(
        data=[
            {"holder_user_id": "one", "code": "AAAA"},
            {"holder_user_id": "two", "code": "BBBB"},
            {"holder_user_id": "two", "code": "CCCC"},
        ]
    )
    links = event_change._refund_links(SimpleNamespace(id=42, school="uwaterloo"), ["one", "two"])
    assert links == {
        "one": "https://uwaterloo.wat2do.io/tickets/AAAA?refund=1",
        "two": "https://uwaterloo.wat2do.io/tickets",
    }


def test_claimed_delivery_retries_timeouts_and_throttling_then_marks_sent(monkeypatch):
    mark_sent = MagicMock()
    mark_failed = MagicMock()
    monkeypatch.setattr(delivery_log, "_mark_log_sent", mark_sent)
    monkeypatch.setattr(delivery_log, "_mark_log_failed", mark_failed)
    timeout = ReadTimeoutError(endpoint_url="https://email.ca-central-1.amazonaws.com")
    throttled = ClientError({"Error": {"Code": "TooManyRequestsException"}}, "SendEmail")
    send = MagicMock(side_effect=[timeout, throttled, True])
    monkeypatch.setattr(delivery_log.email_service, "send", send)

    result = delivery_log.deliver_claimed_email(
        row_id="row-1",
        message=MagicMock(),
        provider_attempts=3,
        log_context="test",
    )

    assert result is True
    assert send.call_count == 3
    mark_sent.assert_called_once_with("row-1")
    mark_failed.assert_not_called()


def test_claimed_delivery_does_not_retry_terminal_provider_error(monkeypatch):
    monkeypatch.setattr(delivery_log, "_mark_log_sent", MagicMock())
    mark_failed = MagicMock()
    monkeypatch.setattr(delivery_log, "_mark_log_failed", mark_failed)
    send = MagicMock(side_effect=ClientError({"Error": {"Code": "MessageRejected"}}, "SendEmail"))
    monkeypatch.setattr(delivery_log.email_service, "send", send)

    result = delivery_log.deliver_claimed_email(
        row_id="row-1",
        message=MagicMock(),
        provider_attempts=3,
        log_context="test",
    )

    assert result is False
    send.assert_called_once()
    mark_failed.assert_called_once_with("row-1", "ses_messagerejected")


@pytest.mark.parametrize("user_count", [0, 1, 499, 500, 501, 1001])
def test_preference_reads_preserve_batch_boundaries(fake_sb, patch_sb, user_count):
    user_ids = [str(index) for index in range(user_count)]
    patch_sb("services.notifications.preferences")
    preferences.get_enabled_user_ids(user_ids, NOTIFICATION_TYPE_MORNING_EMAIL)

    chunks = [call.args[1] for call in fake_sb.in_.call_args_list]
    assert [value for chunk in chunks for value in chunk] == user_ids
    assert all(0 < len(chunk) <= 500 for chunk in chunks)
    assert len(chunks) == (user_count + 499) // 500


@pytest.mark.parametrize("count", [0, 1, 499, 500, 501, 1200])
def test_event_change_reads_recipients_in_batches(monkeypatch, fake_sb, patch_sb, count):
    patch_sb("services.notifications.event_change")
    recipients = [UUID(int=value) for value in range(1, count + 1)]
    fake_sb.set_response(data=[])
    enabled = MagicMock(return_value=set())
    monkeypatch.setattr(event_change, "get_enabled_user_ids", enabled)
    send = MagicMock()
    monkeypatch.setattr(event_change, "_send_event_change", send)

    assert (
        event_change.enqueue_event_change(
            EventResponse.model_validate(_event()),
            {"title": {"old": "Old", "new": "New"}},
            recipients + recipients,
        )
        == 0
    )

    ids = [str(value) for value in recipients]
    assert [call.args for call in fake_sb.in_.call_args_list] == [
        ("id", ids[start : start + 500]) for start in range(0, count, 500)
    ]
    send.assert_not_called()
    if count:
        enabled.assert_called_once_with(ids, NOTIFICATION_TYPE_EVENT_CHANGE)
    else:
        enabled.assert_not_called()


def _occurrence(start: str) -> dict:
    return {
        "id": f"00000000-0000-0000-0000-{start[5:7]}{start[8:10]}{start[11:13]}000000",
        "event_id": 42,
        "dtstart_utc": start,
        "dtend_utc": None,
        "duration": None,
        "tz": "America/Toronto",
    }


def _alert_row(**snapshot) -> dict:
    return {
        "event_id": 42,
        "changed_at": "2026-10-11T14:00:00+00:00",
        "snapshot": {
            "location": "SLC",
            "cancelled": False,
            "occurrences": [
                _occurrence("2026-11-02T18:00:00+00:00"),
                _occurrence("2026-11-09T18:00:00+00:00"),
            ],
            "going_user_ids": [USER_ID],
            **snapshot,
        },
    }


@pytest.fixture
def alerts(monkeypatch, fake_sb, patch_sb):
    patch_sb("services.notifications.event_change")
    current = EventResponse.model_validate(
        _event(
            location="DC 1301",
            occurrences=[
                _occurrence("2026-11-02T19:00:00+00:00"),
                _occurrence("2026-11-09T20:00:00+00:00"),
            ],
        )
    )
    monkeypatch.setattr(event_change.event_service, "get_event", lambda _event_id: current)
    enqueue = MagicMock(return_value=1)
    monkeypatch.setattr(event_change, "enqueue_event_change", enqueue)
    return enqueue


def test_due_alert_sends_one_email_for_every_change_in_a_burst(alerts, fake_sb):
    fake_sb.queue_responses([[_alert_row()], []])
    now = datetime(2026, 10, 11, 14, 10, tzinfo=timezone.utc)

    assert event_change.send_due_alerts(now) == 1

    fake_sb.lte.assert_called_once_with("changed_at", (now - timedelta(minutes=5)).isoformat())
    [call] = alerts.call_args_list
    event, diff, recipients = call.args
    assert event.id == 42
    assert set(diff) == {"location", "occurrences"}
    assert diff["location"] == {"old": "SLC", "new": "DC 1301"}
    assert [o["dtstart_utc"] for o in diff["occurrences"]["new"]] == [
        "2026-11-02T19:00:00+00:00",
        "2026-11-09T20:00:00+00:00",
    ]
    assert recipients == [UUID(USER_ID)]
    fake_sb.delete.assert_called_once()
    fake_sb.eq.assert_any_call("event_id", 42)
    fake_sb.eq.assert_any_call("changed_at", "2026-10-11T14:00:00+00:00")


def test_due_alert_keeps_the_row_when_sending_fails(alerts, fake_sb):
    alerts.side_effect = RuntimeError("provider down")
    fake_sb.queue_responses([[_alert_row()]])

    assert event_change.send_due_alerts() == 0
    fake_sb.delete.assert_not_called()


def test_due_alert_clears_rows_whose_event_is_gone(alerts, fake_sb, monkeypatch):
    monkeypatch.setattr(event_change.event_service, "get_event", lambda _event_id: None)
    fake_sb.queue_responses([[_alert_row()], []])

    assert event_change.send_due_alerts() == 0
    alerts.assert_not_called()
    fake_sb.delete.assert_called_once()


def test_every_email_uses_the_site_font():
    html, _text = _change_email(
        {"location": {"old": "SLC", "new": "DC"}}, image_src="cid:event-image"
    )

    assert "api.fontshare.com/v2/css?f[]=satoshi" in html
    assert "{EMAIL_FONT}" not in html
    assert " sans-serif;" not in html
    assert html.count("font:") == html.count("Satoshi,system-ui")
