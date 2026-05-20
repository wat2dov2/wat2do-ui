"""Service-level tests for ``calendar_service``.

Covers:
- Timezone resolution (canonical, alias, unknown, None, empty).
- Token get-or-create (existing token short-circuits; null triggers
  generate + update).
- Token regeneration (always writes a fresh value).
- Token reverse lookup (hit / miss).
- VCALENDAR rendering: empty-feed shape, event projection (TZID,
  DTSTART/DTEND conversion, UID stability, description composition,
  skip-when-no-dtstart).
"""

from unittest.mock import MagicMock
from uuid import uuid4

from core.tables import EVENTS, USERS
from services import calendar_service, saved_event_service

# ── resolve_school_timezone ─────────────────────────────────────────


def test_resolve_timezone_known_school():
    assert calendar_service.resolve_school_timezone("University of Waterloo") == "America/Toronto"


def test_resolve_timezone_known_school_casefolded():
    assert (
        calendar_service.resolve_school_timezone("  UNIVERSITY of Waterloo ") == "America/Toronto"
    )


def test_resolve_timezone_alias():
    assert calendar_service.resolve_school_timezone("uw") == "America/Toronto"
    assert calendar_service.resolve_school_timezone("UW") == "America/Toronto"
    assert calendar_service.resolve_school_timezone("laurier") == "America/Toronto"


def test_resolve_timezone_unknown_falls_back_to_utc():
    assert calendar_service.resolve_school_timezone("Hogwarts") == "UTC"


def test_resolve_timezone_none_returns_utc():
    assert calendar_service.resolve_school_timezone(None) == "UTC"


def test_resolve_timezone_empty_or_whitespace_returns_utc():
    assert calendar_service.resolve_school_timezone("") == "UTC"
    assert calendar_service.resolve_school_timezone("   ") == "UTC"


# ── get_or_create_token / regenerate_token ──────────────────────────


def test_get_or_create_token_returns_existing(fake_sb, patch_sb):
    """Fast path: token already set — no update happens."""
    patch_sb("services.calendar_service")
    fake_sb.set_response(data=[{"calendar_feed_token": "existing_tok"}])
    user_id = str(uuid4())

    token = calendar_service.get_or_create_token(user_id)

    assert token == "existing_tok"
    fake_sb.table.assert_called_with(USERS)
    fake_sb.eq.assert_any_call("id", user_id)
    fake_sb.update.assert_not_called()


def test_get_or_create_token_generates_when_null(fake_sb, patch_sb):
    """Slow path: null column → generate + UPDATE, return new token."""
    patch_sb("services.calendar_service")
    user_id = str(uuid4())
    fake_sb.execute.side_effect = [
        MagicMock(data=[{"calendar_feed_token": None}], count=0),
        MagicMock(data=[{"id": user_id}], count=0),
    ]

    token = calendar_service.get_or_create_token(user_id)

    assert token and len(token) > 20  # token_urlsafe(32) ≈ 43 chars
    fake_sb.update.assert_called_once()
    update_payload = fake_sb.update.call_args[0][0]
    assert update_payload == {"calendar_feed_token": token}
    fake_sb.eq.assert_any_call("id", user_id)


def test_get_or_create_token_generates_when_row_missing(fake_sb, patch_sb):
    """No user row returned → still generate and store.

    Defensive: if the SELECT returns zero rows for any reason we still
    generate a token.  The UPDATE is a no-op if the user truly doesn't
    exist (no rows matched), but the read path stays simple.
    """
    patch_sb("services.calendar_service")
    user_id = str(uuid4())
    fake_sb.execute.side_effect = [
        MagicMock(data=[], count=0),
        MagicMock(data=[], count=0),
    ]

    token = calendar_service.get_or_create_token(user_id)

    assert token and len(token) > 20
    fake_sb.update.assert_called_once()


def test_regenerate_token_always_writes_new(fake_sb, patch_sb):
    """Regenerate never short-circuits — always rotates."""
    patch_sb("services.calendar_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"id": user_id}])

    token = calendar_service.regenerate_token(user_id)

    assert token and len(token) > 20
    fake_sb.update.assert_called_once()
    update_payload = fake_sb.update.call_args[0][0]
    assert update_payload == {"calendar_feed_token": token}


def test_regenerate_token_produces_different_value_each_call(fake_sb, patch_sb):
    """Two rotations back-to-back return different tokens."""
    patch_sb("services.calendar_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"id": user_id}])

    t1 = calendar_service.regenerate_token(user_id)
    t2 = calendar_service.regenerate_token(user_id)

    assert t1 != t2


# ── get_user_id_by_token ────────────────────────────────────────────


def test_get_user_id_by_token_hit(fake_sb, patch_sb):
    patch_sb("services.calendar_service")
    user_id = str(uuid4())
    fake_sb.set_response(data=[{"id": user_id}])

    assert calendar_service.get_user_id_by_token("tok") == user_id
    fake_sb.eq.assert_any_call("calendar_feed_token", "tok")


def test_get_user_id_by_token_miss(fake_sb, patch_sb):
    patch_sb("services.calendar_service")
    fake_sb.set_response(data=[])

    assert calendar_service.get_user_id_by_token("nope") is None


# ── build_ics_for_user ──────────────────────────────────────────────


def _event_row(**overrides) -> dict:
    """Plain events row — no date columns since the v1-style EventDates
    port (migration 20260428031741). Occurrences come from a separate
    event_dates query; use ``_occurrence_row`` to build those.
    """
    defaults = {
        "id": 42,
        "title": "Jazz Night",
        "description": "Live jazz on the quad",
        "location": "The Quad",
        "school": "University of Waterloo",
        "organization": "Music Club",
        "source_url": None,
        "added_at": "2026-04-15T10:00:00+00:00",
        "created_by": None,
    }
    defaults.update(overrides)
    return defaults


def _occurrence_row(event_id: int, **overrides) -> dict:
    """One event_dates row, shaped to satisfy OccurrenceResponse."""
    defaults = {
        "id": 1,
        "event_id": event_id,
        "dtstart_utc": "2026-05-01T23:00:00+00:00",
        "dtend_utc": "2026-05-02T01:30:00+00:00",
        "duration": None,
        "tz": None,
        "created_at": "2026-04-15T10:00:00+00:00",
    }
    defaults.update(overrides)
    return defaults


def test_build_ics_for_user_empty_saved_list(monkeypatch):
    """No saved events → valid empty VCALENDAR, no VEVENT components."""
    monkeypatch.setattr(
        saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[]),
    )
    body = calendar_service.build_ics_for_user(str(uuid4()))

    text = body.decode()
    assert text.startswith("BEGIN:VCALENDAR")
    assert "END:VCALENDAR" in text
    assert "BEGIN:VEVENT" not in text
    assert "PRODID:-//wat2do//calendar feed//EN" in text


def test_build_ics_for_user_renders_vevent(monkeypatch, fake_sb, patch_sb):
    """One saved event → one VEVENT with expected fields.

    Asserts on TZID (from school), DTSTART in local wall-clock time,
    UID stability (event-id-occ-id pair), SUMMARY, LOCATION, and that
    the description ends with a deep-link back to the event page.
    """
    patch_sb("services.calendar_service")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(
        saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[42]),
    )
    # Two queries land on fake_sb in sequence: events.select.in_, then
    # event_dates.select.in_. Queue both responses.
    fake_sb.queue_responses(
        [
            [_event_row()],  # events
            [_occurrence_row(event_id=42)],  # event_dates
        ]
    )

    body = calendar_service.build_ics_for_user(str(uuid4()))
    text = body.decode()

    assert "BEGIN:VEVENT" in text
    # UID combines event id with the occurrence id so a multi-occurrence
    # event renders distinct VEVENTs that calendar clients can track
    # independently.
    assert "UID:event-42-1@wat2do.app" in text
    assert "SUMMARY:Jazz Night" in text
    # 23:00 UTC = 19:00 America/Toronto in EDT (May)
    assert "DTSTART;TZID=America/Toronto:20260501T190000" in text
    assert "DTEND;TZID=America/Toronto:20260501T213000" in text
    assert "LOCATION:The Quad" in text
    assert "/events/42" in text  # deep-link in URL + description
    fake_sb.table.assert_any_call(EVENTS)
    fake_sb.in_.assert_any_call("id", [42])


def test_build_ics_for_user_skips_events_without_occurrences(monkeypatch, fake_sb, patch_sb):
    """Events with zero occurrences are skipped, not rendered as malformed VEVENT."""
    patch_sb("services.calendar_service")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(
        saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[99]),
    )
    fake_sb.queue_responses(
        [
            [_event_row(id=99)],  # events row exists
            [],  # but no event_dates rows
        ]
    )

    body = calendar_service.build_ics_for_user(str(uuid4()))
    text = body.decode()

    assert "BEGIN:VCALENDAR" in text
    assert "BEGIN:VEVENT" not in text


def test_build_ics_for_user_renders_one_vevent_per_occurrence(monkeypatch, fake_sb, patch_sb):
    """Multi-occurrence event -> N VEVENT components, one per event_dates row.

    Phase 8 invariant: an event with three occurrences must produce three
    distinct VEVENTs in the calendar feed, each with a UID combining
    event id + occurrence id (so calendar clients track them separately
    rather than treating later ones as edits to the first).
    """
    patch_sb("services.calendar_service")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(
        saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[42]),
    )
    fake_sb.queue_responses(
        [
            [_event_row()],
            [
                _occurrence_row(
                    event_id=42,
                    id=111,
                    dtstart_utc="2026-05-01T23:00:00+00:00",
                    dtend_utc="2026-05-02T01:30:00+00:00",
                ),
                _occurrence_row(
                    event_id=42,
                    id=222,
                    dtstart_utc="2026-05-08T23:00:00+00:00",
                    dtend_utc="2026-05-09T01:30:00+00:00",
                ),
                _occurrence_row(
                    event_id=42,
                    id=333,
                    dtstart_utc="2026-05-15T23:00:00+00:00",
                    dtend_utc="2026-05-16T01:30:00+00:00",
                ),
            ],
        ]
    )

    body = calendar_service.build_ics_for_user(str(uuid4()))
    text = body.decode()

    # Three VEVENT components.
    assert text.count("BEGIN:VEVENT") == 3
    assert text.count("END:VEVENT") == 3

    # Each occurrence has a distinct UID combining event + occurrence id.
    assert "UID:event-42-111@wat2do.app" in text
    assert "UID:event-42-222@wat2do.app" in text
    assert "UID:event-42-333@wat2do.app" in text

    # The three DTSTARTs (in America/Toronto local time, May 1/8/15 UTC
    # 23:00 == May 1/8/15 19:00 EDT) are all present.
    assert "DTSTART;TZID=America/Toronto:20260501T190000" in text
    assert "DTSTART;TZID=America/Toronto:20260508T190000" in text
    assert "DTSTART;TZID=America/Toronto:20260515T190000" in text

    # SUMMARY is identical across the three occurrences (same event).
    assert text.count("SUMMARY:Jazz Night") == 3


def test_build_ics_for_user_unknown_school_renders_utc(monkeypatch, fake_sb, patch_sb):
    """School not in the map → DTSTART emitted with TZID=UTC."""
    patch_sb("services.calendar_service")
    patch_sb("services.event_date_service")
    monkeypatch.setattr(
        saved_event_service,
        "get_saved_event_ids",
        MagicMock(return_value=[1]),
    )
    fake_sb.queue_responses(
        [
            [_event_row(id=1, school="Hogwarts")],
            [_occurrence_row(event_id=1)],
        ]
    )

    body = calendar_service.build_ics_for_user(str(uuid4()))
    text = body.decode()

    # UTC wall-clock equals the stored UTC; no TZID conversion.
    assert "DTSTART:20260501T230000Z" in text or "DTSTART;TZID=UTC:20260501T230000" in text
