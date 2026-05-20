"""Calendar subscription feed: per-user ICS.

``GET /calendar/feed/{token}.ics`` emits a VCALENDAR containing every
event the user has saved.  Subscribed calendar clients (Google, Apple,
Outlook) poll this URL and render VEVENTs as calendar entries — time
changes and new saves propagate on the client's next poll.

The token is stored as an opaque column on ``users`` and generated
lazily on the first ``GET /calendar/token`` call.  ``regenerate_token``
rotates — any existing subscriptions break until the user re-adds the
new URL (that's the point of rotation).
"""

import logging
import secrets
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from icalendar import Calendar
from icalendar import Event as ICalEvent

from core.config import settings
from core.constants import SCHOOL_ALIASES, SCHOOL_TIMEZONES
from core.database import get_sb
from core.tables import EVENTS, USERS
from schemas.event import EventResponse
from schemas.event_date import OccurrenceResponse
from services import event_date_service, saved_event_service

log = logging.getLogger(__name__)

# 32 bytes -> ~43 URL-safe characters.  Far above the 128-bit minimum
# for opaque bearer tokens; a leak only exposes the user's saved-event
# list to the holder, and rotation is one endpoint call away.
_TOKEN_BYTES = 32

# Product identifier in the emitted VCALENDAR (required by RFC 5545).
_PRODID = "-//wat2do//calendar feed//EN"

# Fallback when a school is missing from the timezone map.  The log
# warning in ``resolve_school_timezone`` is the signal to add it.
_UTC_TZID = "UTC"


def resolve_school_timezone(school: str | None) -> str:
    """Return the IANA timezone for an ``events.school`` value.

    Lowercase + strip, alias-map, dict lookup, UTC fallback.  Unknown
    values log at ``warning`` so operators see which schools still need
    to be added to ``SCHOOL_TIMEZONES``.
    """
    if not school:
        return _UTC_TZID
    key = school.strip().lower()
    if not key:
        return _UTC_TZID
    canonical = SCHOOL_ALIASES.get(key, key)
    tz = SCHOOL_TIMEZONES.get(canonical)
    if tz is None:
        log.warning(
            "Unknown school %r (canonical %r) in calendar feed — falling back to UTC",
            school,
            canonical,
        )
        return _UTC_TZID
    return tz


def get_or_create_token(user_id: str) -> str:
    """Return the user's calendar-feed token, generating one if absent."""
    r = get_sb().table(USERS).select("calendar_feed_token").eq("id", user_id).limit(1).execute()
    if r.data:
        existing = r.data[0].get("calendar_feed_token")
        if existing:
            return existing
    return _generate_and_store_token(user_id)


def regenerate_token(user_id: str) -> str:
    """Rotate the user's calendar-feed token.

    Any existing calendar subscriptions break until the user re-adds
    the new URL — intentional leak containment.
    """
    return _generate_and_store_token(user_id)


def _generate_and_store_token(user_id: str) -> str:
    token = secrets.token_urlsafe(_TOKEN_BYTES)
    (get_sb().table(USERS).update({"calendar_feed_token": token}).eq("id", user_id).execute())
    return token


def get_user_id_by_token(token: str) -> str | None:
    """Reverse-lookup: return the user id for a feed token, or None."""
    r = get_sb().table(USERS).select("id").eq("calendar_feed_token", token).limit(1).execute()
    if not r.data:
        return None
    return r.data[0]["id"]


def build_ics_for_user(user_id: str) -> bytes:
    """Render the user's saved events as a VCALENDAR document."""
    event_ids = saved_event_service.get_saved_event_ids(user_id)
    events = _fetch_events_by_ids(event_ids)

    cal = Calendar()
    cal.add("prodid", _PRODID)
    cal.add("version", "2.0")
    cal.add("calscale", "GREGORIAN")
    cal.add("method", "PUBLISH")
    cal.add("x-wr-calname", "wat2do")

    dtstamp = datetime.now(timezone.utc)
    for event in events:
        for vevent in _event_to_vevents(event, dtstamp):
            cal.add_component(vevent)

    return cal.to_ical()


def _fetch_events_by_ids(event_ids: list[int]) -> list[EventResponse]:
    """Chunked fetch preserving the caller's ordering, with occurrences attached.

    PostgREST ``in_`` has practical length limits, so chunk the ids.
    Occurrences are batched separately (one query per chunk) and joined
    in Python — avoids an N+1 fetch for a feed with many saved events.
    """
    if not event_ids:
        return []
    chunk_size = 1000
    rows_by_id: dict[int, dict] = {}
    for start in range(0, len(event_ids), chunk_size):
        batch = event_ids[start : start + chunk_size]
        r = get_sb().table(EVENTS).select("*").in_("id", batch).execute()
        for row in r.data or []:
            rows_by_id[row["id"]] = row

    occ_by_event = event_date_service.list_for_events(list(rows_by_id.keys()))

    ordered: list[EventResponse] = []
    for eid in event_ids:
        row = rows_by_id.get(eid)
        if row is not None:
            payload = dict(row)
            payload["occurrences"] = [o.model_dump(mode="json") for o in occ_by_event.get(eid, [])]
            # Calendar feed only iterates ``occurrences``; the primary
            # date convenience fields are unused, so leave them None to
            # avoid an extra _pick_primary call here.
            ordered.append(EventResponse.model_validate(payload))
    return ordered


def _event_to_vevents(event: EventResponse, dtstamp: datetime) -> list[ICalEvent]:
    """Emit one VEVENT per occurrence on the event.

    Events with zero occurrences are skipped — RFC 5545 requires DTSTART
    on every VEVENT, and a calendar entry with no time is nonsensical.
    Each VEVENT carries a UID that combines the event id with the
    occurrence id so calendar clients distinguish recurrences without
    treating them as edits to a single underlying entry.
    """
    if not event.occurrences:
        log.debug("Skipping event %d in ICS feed: no occurrences", event.id)
        return []

    tzid = resolve_school_timezone(event.school)
    try:
        tzinfo = ZoneInfo(tzid)
    except ZoneInfoNotFoundError:
        log.warning("ZoneInfo database missing %r — using UTC for event %d", tzid, event.id)
        tzinfo = timezone.utc

    frontend = _frontend_base_url()
    event_url = f"{frontend}/events/{event.id}"

    description_parts: list[str] = []
    if event.organization:
        description_parts.append(event.organization)
    if event.description:
        description_parts.append(event.description)
    description_parts.append(event_url)
    description = "\n\n".join(description_parts)

    components: list[ICalEvent] = []
    for occ in event.occurrences:
        components.append(
            _occurrence_to_vevent(
                event=event,
                occurrence=occ,
                tzinfo=tzinfo,
                event_url=event_url,
                description=description,
                dtstamp=dtstamp,
            )
        )
    return components


def _occurrence_to_vevent(
    *,
    event: EventResponse,
    occurrence: OccurrenceResponse,
    tzinfo,
    event_url: str,
    description: str,
    dtstamp: datetime,
) -> ICalEvent:
    v = ICalEvent()
    v.add("uid", f"event-{event.id}-{occurrence.id}@wat2do.app")
    v.add("summary", event.title)
    v.add("dtstart", occurrence.dtstart_utc.astimezone(tzinfo))
    if occurrence.dtend_utc is not None:
        v.add("dtend", occurrence.dtend_utc.astimezone(tzinfo))
    v.add("location", event.location)
    v.add("description", description)
    v.add("url", event_url)
    v.add("dtstamp", dtstamp)
    v.add("last-modified", event.added_at)
    v.add("sequence", 0)
    return v


def _frontend_base_url() -> str:
    """First configured CORS origin, or the canonical prod URL as fallback.

    The backend only grants credentials to CORS-allowed origins, so the
    first entry is the frontend by construction.  Dev env serves from
    localhost; prod from wat2do.app.
    """
    if settings.cors_origins:
        return settings.cors_origins[0].rstrip("/")
    return "https://wat2do.app"
