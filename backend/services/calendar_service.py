"""Calendar subscription feed: per-user ICS.

``GET /calendar/feed/{token}.ics`` emits a VCALENDAR containing every
event the user is going to.  Subscribed calendar clients (Google, Apple,
Outlook) poll this URL and render VEVENTs as calendar entries - time
changes and new goings propagate on the client's next poll.

The token is stored as an opaque column on ``users`` and generated
lazily on the first ``GET /calendar/token`` call.  ``regenerate_token``
rotates - any existing subscriptions break until the user re-adds the
new URL (that's the point of rotation).
"""

import logging
import secrets
from datetime import datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from icalendar import Calendar
from icalendar import Event as ICalEvent

from core.config import settings
from core.database import get_sb
from core.tables import EVENTS, USERS
from schemas.event import EventResponse
from schemas.event_date import OccurrenceResponse
from schemas.going_event import GoingEventSelection
from services import event_date_service, event_query, going_event_service
from services.school_context import resolve_school_timezone

log = logging.getLogger(__name__)

# 32 bytes -> ~43 URL-safe characters.  Far above the 128-bit minimum
# for opaque bearer tokens; a leak only exposes the user's going-event
# list to the holder, and rotation is one endpoint call away.
_TOKEN_BYTES = 32

# Product identifier in the emitted VCALENDAR (required by RFC 5545).
_PRODID = "-//wat2do//calendar feed//EN"


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
    the new URL - intentional leak containment.
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
    """Render the user's going events as a VCALENDAR document."""
    selections = going_event_service.get_going_event_selections(user_id)
    events = _fetch_selected_events(selections)

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


def _fetch_selected_events(
    selections: list[GoingEventSelection],
) -> list[EventResponse]:
    """Fetch event rows and only the occurrences explicitly selected Going.

    Both table reads are chunked and joined in memory, so large calendars avoid
    PostgREST URL limits without loading every occurrence for each event.
    """
    event_ids = [selection.event_id for selection in selections]
    if not event_ids:
        return []
    chunk_size = 1000
    rows_by_id: dict[int, dict] = {}
    for start in range(0, len(event_ids), chunk_size):
        batch = event_ids[start : start + chunk_size]
        r = get_sb().table(EVENTS).select("*").in_("id", batch).execute()
        for row in r.data or []:
            rows_by_id[row["id"]] = row

    occurrence_ids = [
        str(occurrence_id) for selection in selections for occurrence_id in selection.occurrence_ids
    ]
    selected_occurrences = event_date_service.list_by_ids(occurrence_ids)
    occ_by_event: dict[int, list[OccurrenceResponse]] = {}
    for occurrence in selected_occurrences:
        occ_by_event.setdefault(occurrence.event_id, []).append(occurrence)

    ordered: list[EventResponse] = []
    for eid in event_ids:
        row = rows_by_id.get(eid)
        if row is not None:
            # Calendar feed only iterates ``occurrences``; hydrate_event
            # attaches that list and does not invent a primary date.
            ordered.append(event_query.hydrate_event(row, occ_by_event.get(eid, []), EventResponse))
    return ordered


def _event_to_vevents(event: EventResponse, dtstamp: datetime) -> list[ICalEvent]:
    """Emit one VEVENT per occurrence on the event.

    Events with zero occurrences are skipped - RFC 5545 requires DTSTART
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
        log.warning("ZoneInfo database missing %r - using UTC for event %d", tzid, event.id)
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
    localhost; prod from wat2do.io.
    """
    if settings.cors_origins:
        return settings.cors_origins[0].rstrip("/")
    return "https://wat2do.io"
