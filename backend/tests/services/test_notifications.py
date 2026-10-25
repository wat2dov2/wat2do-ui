from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import UUID
from zoneinfo import ZoneInfo

import pytest
from botocore.exceptions import ClientError, ReadTimeoutError  # type: ignore[import-untyped]

from core.config import settings
from core.constants import (
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
)
from jobs import send_notifications
from schemas.event import EventResponse
from schemas.notification_preference import NotificationPreferenceUpdate
from services.email_service import InlineImage
from services.notifications import (
    delivery_log,
    event_change,
    event_reminder,
    morning_email,
    preferences,
    rendering,
    unsubscribe,
)

USER_ID = "11111111-1111-1111-1111-111111111111"


@pytest.fixture(autouse=True)
def _school_timezone(monkeypatch):
    def resolve_timezone(_user):
        return ZoneInfo("America/Toronto")

    monkeypatch.setattr(morning_email, "resolve_user_timezone", resolve_timezone)
    monkeypatch.setattr(event_reminder, "resolve_user_timezone", resolve_timezone)
    monkeypatch.setattr(morning_email.school_service, "get_school_id", lambda _school: 1)


def _user(**overrides) -> dict:
    defaults = {
        "id": USER_ID,
        "email": "alice@uwaterloo.ca",
        "school": "uwaterloo",
    }
    defaults.update(overrides)
    return defaults


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


def test_preferences_resolve_only_active_defaults(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    fake_sb.set_response(
        data=[
            {
                "notification_type": NOTIFICATION_TYPE_EVENT_CHANGE,
                "enabled": False,
                "updated_at": None,
            }
        ]
    )

    result = preferences.get_preferences(USER_ID)

    assert [item.notification_type for item in result] == [
        NOTIFICATION_TYPE_MORNING_EMAIL,
        NOTIFICATION_TYPE_EVENT_REMINDER,
        NOTIFICATION_TYPE_EVENT_CHANGE,
    ]
    assert result[0].enabled is True
    assert result[1].enabled is True
    assert result[2].enabled is False


def test_set_preferences_atomically_records_choice_and_source(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    preferences.set_preferences(
        USER_ID,
        [
            NotificationPreferenceUpdate(
                notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
                enabled=False,
            )
        ],
        source="settings",
    )
    name, payload = fake_sb.rpc.call_args.args
    assert name == "set_notification_preferences"
    assert payload["p_user_id"] == USER_ID
    assert payload["p_source"] == "settings"
    assert payload["p_notice_version"]
    assert payload["p_updates"] == [{"notification_type": "morning_email", "enabled": False}]
    fake_sb.upsert.assert_not_called()


def test_morning_email_reaches_everyone_who_has_not_turned_it_off(fake_sb, patch_sb):
    patch_sb("services.notifications.preferences")
    fake_sb.set_response(data=[])
    assert preferences.is_enabled(USER_ID, NOTIFICATION_TYPE_MORNING_EMAIL) is True
    assert preferences.get_enabled_user_ids([USER_ID], NOTIFICATION_TYPE_MORNING_EMAIL) == {USER_ID}
    fake_sb.set_response(data=[{"user_id": USER_ID, "enabled": False}])
    assert preferences.get_enabled_user_ids([USER_ID], NOTIFICATION_TYPE_MORNING_EMAIL) == set()


def test_unsubscribe_records_withdrawal_for_signed_user(monkeypatch):
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    setter = MagicMock()
    monkeypatch.setattr(unsubscribe, "set_preferences", setter)
    token = unsubscribe.create_unsubscribe_token(USER_ID, NOTIFICATION_TYPE_MORNING_EMAIL)
    assert unsubscribe.unsubscribe(token) is True
    assert setter.call_args.args[0] == USER_ID
    assert setter.call_args.args[1][0].enabled is False
    assert setter.call_args.kwargs == {"source": "unsubscribe"}
    setter.reset_mock()
    assert unsubscribe.unsubscribe(token + "tampered") is False
    setter.assert_not_called()


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


def test_morning_subject_counts_events_and_positions():
    assert rendering.morning_email_subject(4, 2) == "4 new events and 2 new positions"
    assert rendering.morning_email_subject(1, 0) == "1 new event"
    assert rendering.morning_email_subject(0, 1) == "1 new position"


def _position(**overrides) -> dict:
    defaults = {
        "id": 7,
        "title": "VP Events",
        "deadline_at": "2026-05-08T03:59:00+00:00",
        "image_src": "cid:position-7",
        "club_name": "Esports",
        "club_logo_src": "cid:club-esports",
    }
    defaults.update(overrides)
    return defaults


def _morning_html(events, positions) -> str:
    return rendering.render_morning_email_html(
        subject="2 new events",
        events=events,
        positions=positions,
        tz=ZoneInfo("America/Toronto"),
        frontend_url="https://uwaterloo.wat2do.io",
        preferences_url="https://uwaterloo.wat2do.io/settings",
        unsubscribe_url="https://uwaterloo.wat2do.io/unsubscribe",
    )


def test_morning_html_escapes_event_values():
    html = _morning_html(
        [_event(title="<script>alert(1)</script>", location="SLC & DC", image_src="cid:event-42")],
        [],
    )

    assert "<script>" not in html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "SLC &amp; DC" in html
    assert 'src="cid:event-42"' in html
    assert "background:#f9f9f9" in html
    assert 'href="https://uwaterloo.wat2do.io/events/42"' in html
    assert "New positions" not in html


def test_morning_html_lays_cards_out_two_per_row():
    html = _morning_html(
        [_event(id=event_id, image_src=None) for event_id in (1, 2, 3)],
        [_position()],
    )

    events_table, positions_table = html.split("New positions")
    assert events_table.count("<tr>") == 2
    assert events_table.count('width="50%"') == 4
    assert "Tea Tasting" in events_table
    assert 'src="cid:position-7"' in positions_table
    assert "Apply by Thu, May 7" in positions_table
    assert 'href="https://uwaterloo.wat2do.io/positions"' in positions_table
    assert 'src="cid:club-esports"' in positions_table
    assert "Esports" in positions_table


def _change_email(diff, image_src=None, **event_fields):
    args = {
        "subject": "Changed: Tea Tasting",
        "event": _event(**event_fields),
        "diff": diff,
        "image_src": image_src,
        "tz": ZoneInfo("America/Toronto"),
        "frontend_url": "https://uwaterloo.wat2do.io",
        "preferences_url": "https://uwaterloo.wat2do.io/settings",
        "unsubscribe_url": "https://uwaterloo.wat2do.io/unsubscribe",
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
        )
    claim.assert_not_called()


def test_unsubscribe_token_round_trip_and_tamper(monkeypatch):
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    token = unsubscribe.create_unsubscribe_token(
        USER_ID,
        NOTIFICATION_TYPE_EVENT_REMINDER,
    )

    assert unsubscribe.verify_unsubscribe_token(token) == unsubscribe.UnsubscribeTarget(
        user_id=USER_ID,
        notification_type=NOTIFICATION_TYPE_EVENT_REMINDER,
    )
    assert unsubscribe.verify_unsubscribe_token(f"{token}x") is None


def test_unsubscribe_all_binary_signatures_round_trip(monkeypatch):
    for index in range(128):
        monkeypatch.setattr(settings, "email_unsubscribe_secret", f"test-secret-{index}")
        token = unsubscribe.create_unsubscribe_token(USER_ID, NOTIFICATION_TYPE_MORNING_EMAIL)
        assert unsubscribe.verify_unsubscribe_token(token) == unsubscribe.UnsubscribeTarget(
            USER_ID, NOTIFICATION_TYPE_MORNING_EMAIL
        )


def test_dispatch_composes_each_school_once_and_sends_everyone_there(monkeypatch):
    users = [_user(id=f"11111111-1111-1111-1111-{index:012d}") for index in range(20)]
    users.append(_user(id="22222222-2222-2222-2222-222222222222", school="quiet-school"))
    preference_reads = []
    digests = {
        "uwaterloo": morning_email._SchoolDigest(events=[_event()], positions=[], images=[]),
        "quiet-school": morning_email._SchoolDigest(events=[], positions=[], images=[]),
    }
    loaded = []

    monkeypatch.setattr(morning_email, "_fetch_users", lambda: users)
    monkeypatch.setattr(morning_email, "_eligible_users", lambda found, _now: found)
    monkeypatch.setattr(
        morning_email,
        "get_enabled_user_ids",
        lambda ids, _type: preference_reads.append(1) or set(ids),
    )
    monkeypatch.setattr(
        morning_email,
        "_load_school_digest",
        lambda school, _now: loaded.append(school) or digests[school],
    )
    sends = []
    monkeypatch.setattr(
        morning_email,
        "_send_prepared_email",
        lambda **kwargs: sends.append(kwargs["user"]["id"]) or True,
    )

    stats = morning_email.dispatch_morning_emails(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))

    assert stats == {"eligible": 21, "prepared": 20, "sent": 20, "failed": 0, "skipped": 0}
    assert preference_reads == [1]
    assert loaded == ["quiet-school", "uwaterloo"]
    assert sends == [user["id"] for user in users[:20]]


def test_morning_email_eligibility_tracks_eastern_dst_and_delayed_starts():
    user = _user()

    assert morning_email._eligible_users(
        [user],
        datetime(2026, 1, 15, 14, tzinfo=timezone.utc),
    ) == [user]
    assert morning_email._eligible_users(
        [user],
        datetime(2026, 7, 15, 13, 59, tzinfo=timezone.utc),
    ) == [user]
    assert (
        morning_email._eligible_users(
            [user],
            datetime(2026, 7, 15, 12, 59, tzinfo=timezone.utc),
        )
        == []
    )


def test_notification_job_fails_when_any_delivery_fails(monkeypatch):
    dispatch = MagicMock(
        return_value={
            "eligible": 2,
            "prepared": 2,
            "sent": 1,
            "failed": 1,
            "skipped": 0,
        }
    )
    monkeypatch.setattr(send_notifications, "dispatch_morning_emails", dispatch)
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_MORNING_EMAIL,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 1
    dispatch.assert_called_once_with(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))


def test_notification_job_succeeds_without_delivery_failures(monkeypatch):
    monkeypatch.setattr(
        send_notifications,
        "dispatch_morning_emails",
        MagicMock(
            return_value={
                "eligible": 2,
                "prepared": 1,
                "sent": 1,
                "failed": 0,
                "skipped": 0,
            }
        ),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_MORNING_EMAIL,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 0


def test_notification_job_dispatches_event_reminders(monkeypatch):
    dispatch = MagicMock(
        return_value={
            "due": 1,
            "prepared": 1,
            "sent": 1,
            "failed": 0,
            "skipped": 0,
        }
    )
    monkeypatch.setattr(send_notifications, "dispatch_event_reminders", dispatch)
    monkeypatch.setattr(
        "sys.argv",
        [
            "send_notifications.py",
            "--notification",
            NOTIFICATION_TYPE_EVENT_REMINDER,
            "--now",
            "2026-05-01T13:00:00+00:00",
        ],
    )

    assert send_notifications.main() == 0
    dispatch.assert_called_once_with(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))


def test_new_event_and_position_loaders_use_fixed_previous_24_hours(fake_sb, patch_sb):
    patch_sb("services.notifications.morning_email")
    fake_sb.set_response(data=[])
    window_end = datetime(2026, 5, 1, 13, tzinfo=timezone.utc)

    assert morning_email._load_new_events(1, window_end) == []
    assert morning_email._load_new_positions(1, window_end) == []
    assert fake_sb.gt.call_args_list == [(("added_at", "2026-04-30T13:00:00+00:00"),)] * 2


def test_card_images_embed_posters_and_each_club_logo_once(monkeypatch):
    requested = []

    def fake_image(url, content_id, *, width, square):
        requested.append((url, width))
        assert square is True
        if not url or url.endswith("broken.jpg"):
            return None
        return InlineImage(content_id, f"{content_id}.jpg", "image/jpeg", b"x")

    monkeypatch.setattr(morning_email, "email_image", fake_image)
    logo = "https://wat2do.io/media/club.png"
    events = [
        {"id": 1, "source_image_url": "https://wat2do.io/media/ok.jpg", "club_logo_url": logo},
        {"id": 2, "source_image_url": "https://wat2do.io/media/broken.jpg", "club_logo_url": logo},
    ]
    positions = [{"id": 7, "source_image_url": None, "club_logo_url": None}]

    images = morning_email._embed_card_images(events, positions)

    card_px, logo_px = morning_email._CONTROL.card_image_px, morning_email._CONTROL.club_logo_px
    assert requested.count((logo, logo_px)) == 1
    assert ("https://wat2do.io/media/ok.jpg", card_px) in requested
    assert [image.content_id for image in images][0] == "event-1"
    assert [item["image_src"] for item in [*events, *positions]] == [
        "cid:event-1",
        "https://wat2do.io/media/broken.jpg",
        None,
    ]
    assert events[0]["club_logo_src"] == events[1]["club_logo_src"]
    assert events[0]["club_logo_src"].startswith("cid:club-")
    assert positions[0]["club_logo_src"] is None


def test_loaders_flatten_the_posting_club(fake_sb, patch_sb):
    patch_sb("services.notifications.morning_email")
    fake_sb.set_response(
        data=[
            {"id": 7, "title": "VP Events", "clubs": {"club_name": "Esports", "logo_url": "l.png"}}
        ]
    )

    [position] = morning_email._load_new_positions(1, datetime(2026, 5, 1, tzinfo=timezone.utc))

    assert (position["club_name"], position["club_logo_url"]) == ("Esports", "l.png")
    assert "clubs" not in position


def test_digest_keeps_one_card_per_post():
    post = "https://www.instagram.com/p/ABC/"
    rows = [
        {"id": 9, "source_url": post},
        {"id": 4, "source_url": "https://www.instagram.com/p/XYZ/"},
        {"id": 3, "source_url": post},
        {"id": 5, "source_url": None},
        {"id": 6, "source_url": None},
    ]

    assert [row["id"] for row in morning_email._one_card_per_post(rows)] == [4, 3, 5, 6]


def test_event_reminder_window_centers_on_one_hour():
    now = datetime(2026, 5, 1, 13, tzinfo=timezone.utc)

    assert event_reminder._reminder_window(now) == (
        now + timedelta(minutes=45),
        now + timedelta(minutes=65),
    )


def test_event_reminder_loader_uses_occurrence_window(fake_sb, patch_sb):
    patch_sb("services.notifications.event_reminder")
    fake_sb.set_response(data=[])
    window_start = datetime(2026, 5, 1, 13, 45, tzinfo=timezone.utc)
    window_end = datetime(2026, 5, 1, 14, 5, tzinfo=timezone.utc)

    assert event_reminder._load_due_reminders(window_start, window_end) == []

    fake_sb.gte.assert_called_once_with(
        "occurrence.dtstart_utc",
        "2026-05-01T13:45:00+00:00",
    )
    fake_sb.lt.assert_called_once_with(
        "occurrence.dtstart_utc",
        "2026-05-01T14:05:00+00:00",
    )
    fake_sb.eq.assert_called_once_with("event.cancelled", False)


def test_event_reminder_dispatch_uses_preferences_and_selected_occurrences(monkeypatch):
    reminder = {
        "user_id": USER_ID,
        "event_date_id": "22222222-2222-2222-2222-222222222222",
        "event": _event(),
    }
    monkeypatch.setattr(event_reminder, "_load_due_reminders", lambda _start, _end: [reminder])
    monkeypatch.setattr(event_reminder, "_load_users", lambda _ids: {USER_ID: _user()})
    monkeypatch.setattr(
        event_reminder,
        "get_enabled_user_ids",
        lambda _ids, _notification_type: {USER_ID},
    )
    poster = InlineImage("event-image", "event-image.jpg", "image/jpeg", b"x")
    downloads = []
    monkeypatch.setattr(
        event_reminder, "event_hero_image", lambda url: downloads.append(url) or poster
    )
    send = MagicMock(return_value=True)
    monkeypatch.setattr(event_reminder, "_send_event_reminder", send)

    stats = event_reminder.dispatch_event_reminders(datetime(2026, 5, 1, 13, tzinfo=timezone.utc))

    assert stats == {
        "due": 1,
        "prepared": 1,
        "sent": 1,
        "failed": 0,
        "skipped": 0,
    }
    send.assert_called_once_with(user=_user(), reminder=reminder, image=poster)
    assert downloads == [None]


def test_event_reminder_send_is_idempotent_per_occurrence_start(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.io")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    claim = MagicMock(return_value="row-1")
    monkeypatch.setattr(event_reminder, "claim_delivery", claim)
    deliver = MagicMock(return_value=True)
    monkeypatch.setattr(event_reminder, "deliver_claimed_email", deliver)
    reminder = {
        "user_id": USER_ID,
        "event_date_id": "22222222-2222-2222-2222-222222222222",
        "event": _event(title="<Tea>"),
    }

    poster = InlineImage("event-image", "event-image.jpg", "image/jpeg", b"x")

    assert (
        event_reminder._send_event_reminder(user=_user(), reminder=reminder, image=poster) is True
    )

    claim.assert_called_once_with(
        user_id=USER_ID,
        notification_type=NOTIFICATION_TYPE_EVENT_REMINDER,
        target_id=("22222222-2222-2222-2222-222222222222:2026-05-01T15:00:00+00:00"),
    )
    message = deliver.call_args.kwargs["message"]
    assert message.subject == "Starts in about 1 hour: <Tea>"
    assert "&lt;Tea&gt;" in message.body_html
    assert "https://uwaterloo.wat2do.io/events/42" in message.body_html
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert '<img src="cid:event-image"' in message.body_html
    assert [image.content_id for image in message.inline_images] == ["wat2do-logo", "event-image"]
    assert "- When: Fri, May 1, 11 AM" in message.body_text
    assert "- Where: SLC" in message.body_text


def test_event_reminder_rendering_failure_claims_no_delivery(monkeypatch):
    claim = MagicMock()
    monkeypatch.setattr(event_reminder, "claim_delivery", claim)
    monkeypatch.setattr(event_reminder, "unsubscribe_url", MagicMock(side_effect=RuntimeError))
    reminder = {"user_id": USER_ID, "event_date_id": "d", "event": _event()}

    with pytest.raises(RuntimeError):
        event_reminder._send_event_reminder(user=_user(), reminder=reminder, image=None)
    claim.assert_not_called()


_DIGEST = morning_email._SchoolDigest(
    events=[_event(image_src="cid:event-42")],
    positions=[_position()],
    images=[InlineImage("event-42", "event-42.jpg", "image/jpeg", b"x")],
)


def test_send_prepared_email_adds_unsubscribe_headers_and_embedded_cards(monkeypatch):
    monkeypatch.setattr(settings, "frontend_url", "https://wat2do.io")
    monkeypatch.setattr(settings, "email_unsubscribe_secret", "test-secret")
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: "row-1")
    deliver = MagicMock(return_value=True)
    monkeypatch.setattr(morning_email, "deliver_claimed_email", deliver)

    result = morning_email._send_prepared_email(
        user=_user(),
        digest=_DIGEST,
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is True
    message = deliver.call_args.kwargs["message"]
    assert message.headers["List-Unsubscribe"].startswith("<https://uwaterloo.wat2do.io/")
    assert message.headers["List-Unsubscribe-Post"] == "List-Unsubscribe=One-Click"
    assert "https://uwaterloo.wat2do.io/events/42" in message.body_html
    assert message.subject == "1 new event and 1 new position"
    assert [image.content_id for image in message.inline_images] == ["wat2do-logo", "event-42"]
    assert "New positions" in message.body_text


def test_send_prepared_email_skips_when_delivery_is_already_claimed(monkeypatch):
    monkeypatch.setattr(morning_email, "claim_delivery", lambda **_kwargs: None)
    deliver = MagicMock()
    monkeypatch.setattr(morning_email, "deliver_claimed_email", deliver)

    result = morning_email._send_prepared_email(
        user=_user(),
        digest=_DIGEST,
        window_end=datetime(2026, 5, 1, 13, tzinfo=timezone.utc),
    )

    assert result is None
    deliver.assert_not_called()


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
@pytest.mark.parametrize("loader", ["reminders", "preferences"])
def test_user_reads_preserve_batch_boundaries(fake_sb, patch_sb, user_count, loader):
    user_ids = [str(index) for index in range(user_count)]
    if loader == "reminders":
        patch_sb("services.notifications.event_reminder")
        event_reminder._load_users(user_ids)
    else:
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
