"""Batched composition and isolated delivery of the 9 AM morning email.

Every recipient at a school gets the same digest: each event and position added
there in the last 24 hours, newest first.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import batched

from core.constants import NOTIFICATION_TYPE_MORNING_EMAIL
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENT_DATES, EVENTS, POSITIONS, USERS
from services import school_service
from services.email_service import EmailMessage, InlineImage
from services.notifications.delivery_log import (
    claim_delivery,
    deliver_claimed_email,
)
from services.notifications.email_images import email_image
from services.notifications.preferences import get_enabled_user_ids
from services.notifications.rendering import (
    EMAIL_LOGO,
    morning_email_subject,
    render_morning_email_html,
    render_morning_email_text,
)
from services.notifications.unsubscribe import unsubscribe_url
from services.school_context import resolve_user_timezone, school_frontend_url

log = logging.getLogger(__name__)

_CONTROL = controlbox.morning_email
_CONTENT_WINDOW = timedelta(hours=_CONTROL.new_event_window_hours)
_CHUNK_SIZE = 500


@dataclass(frozen=True)
class _SchoolDigest:
    """One school's new events and positions, shared by every recipient there."""

    events: list[dict]
    positions: list[dict]
    images: list[InlineImage]


def dispatch_morning_emails(now_utc: datetime) -> dict[str, int]:
    """Compose each school's digest once from batched reads, then send independently."""
    window_end = _aware_utc(now_utc)
    users = _eligible_users(_fetch_users(), window_end)
    if users:
        enabled_ids = get_enabled_user_ids(
            [str(user["id"]) for user in users], NOTIFICATION_TYPE_MORNING_EMAIL
        )
        users = [user for user in users if str(user["id"]) in enabled_ids]
    if not users:
        return {"eligible": 0, "prepared": 0, "sent": 0, "failed": 0, "skipped": 0}

    schools = sorted({str(user["school"]) for user in users if user.get("school")})
    digests = {school: _load_school_digest(school, window_end) for school in schools}

    prepared = 0
    sent = 0
    failed = 0
    skipped = 0
    for user in users:
        digest = digests.get(str(user.get("school")))
        if digest is None or not (digest.events or digest.positions):
            continue

        prepared += 1
        delivery_result = _send_prepared_email(
            user=user,
            digest=digest,
            window_end=window_end,
        )
        if delivery_result is True:
            sent += 1
        elif delivery_result is False:
            failed += 1
        else:
            skipped += 1

    stats = {
        "eligible": len(users),
        "prepared": prepared,
        "sent": sent,
        "failed": failed,
        "skipped": skipped,
    }
    log.info("Morning email dispatch complete: %s", stats)
    return stats


def _fetch_users() -> list[dict]:
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(USERS)
                .select(f"id,email,school_id,{school_service.SCHOOL_SLUG_EMBED}")
                .not_.is_("email", "null")
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )
    return [school_service.with_school_slug(row) for row in rows]


def _eligible_users(users: list[dict], now_utc: datetime) -> list[dict]:
    return [
        user
        for user in users
        if now_utc.astimezone(resolve_user_timezone(user)).hour == _CONTROL.local_send_hour
    ]


def _load_school_digest(school: str, window_end: datetime) -> _SchoolDigest:
    school_id = school_service.get_school_id(school)
    if school_id is None:
        return _SchoolDigest(events=[], positions=[], images=[])
    events = _load_new_events(school_id, window_end)
    positions = _load_new_positions(school_id, window_end)
    images = _embed_card_images(events, "event") + _embed_card_images(positions, "position")
    return _SchoolDigest(events=events, positions=positions, images=images)


def _load_new_events(school_id: str, window_end: datetime) -> list[dict]:
    """Upcoming, uncancelled events added in the window, newest first."""
    rows = fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(EVENTS)
                .select("id,title,location,source_image_url,added_at")
                .eq("school_id", school_id)
                .eq("cancelled", False)
                .gt("added_at", (window_end - _CONTENT_WINDOW).isoformat())
                .lte("added_at", window_end.isoformat())
                .order("added_at", desc=True)
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )
    by_id = {int(row["id"]): row for row in rows}

    earliest_occurrence: dict[int, dict] = {}
    for event_id_chunk in batched(by_id, _CHUNK_SIZE):
        occurrence_rows = (
            get_sb()
            .table(EVENT_DATES)
            .select("event_id,dtstart_utc,dtend_utc")
            .in_("event_id", event_id_chunk)
            .gte("dtstart_utc", window_end.isoformat())
            .order("dtstart_utc")
            .execute()
        ).data or []
        for occurrence in occurrence_rows:
            earliest_occurrence.setdefault(int(occurrence["event_id"]), occurrence)

    return [
        {
            **event,
            "dtstart_utc": earliest_occurrence[event_id]["dtstart_utc"],
            "dtend_utc": earliest_occurrence[event_id].get("dtend_utc"),
        }
        for event_id, event in by_id.items()
        if event_id in earliest_occurrence
    ]


def _load_new_positions(school_id: str, window_end: datetime) -> list[dict]:
    """Active positions added in the window, newest first."""
    return fetch_all_pages(
        lambda offset, page_size: (
            (
                get_sb()
                .table(POSITIONS)
                .select("id,title,source_image_url,deadline_at,deadline_date,added_at")
                .eq("school_id", school_id)
                .eq("is_active", True)
                .gt("added_at", (window_end - _CONTENT_WINDOW).isoformat())
                .lte("added_at", window_end.isoformat())
                .order("added_at", desc=True)
                .order("id")
                .range(offset, offset + page_size - 1)
                .execute()
            ).data
            or []
        )
    )


def _embed_card_images(items: list[dict], kind: str) -> list[InlineImage]:
    """Embed each item's poster as a square card image, linking the original when that fails.

    Sets ``image_src`` on every item for the renderer.
    """
    with ThreadPoolExecutor(max_workers=_CONTROL.image_download_concurrency) as pool:
        images = list(
            pool.map(
                lambda item: email_image(
                    item.get("source_image_url"),
                    f"{kind}-{int(item['id'])}",
                    width=_CONTROL.card_image_px,
                    square=True,
                ),
                items,
            )
        )
    for item, image in zip(items, images, strict=True):
        item["image_src"] = f"cid:{image.content_id}" if image else item.get("source_image_url")
    return [image for image in images if image]


def _send_prepared_email(
    *,
    user: dict,
    digest: _SchoolDigest,
    window_end: datetime,
) -> bool | None:
    user_id = str(user["id"])
    tz = resolve_user_timezone(user)
    target_id = window_end.astimezone(tz).date().isoformat()
    row_id = claim_delivery(
        user_id=user_id,
        notification_type=NOTIFICATION_TYPE_MORNING_EMAIL,
        target_id=target_id,
    )
    if row_id is None:
        return None

    frontend_url = school_frontend_url(user.get("school"))
    unsubscribe = unsubscribe_url(
        user_id,
        NOTIFICATION_TYPE_MORNING_EMAIL,
        user.get("school"),
    )
    preferences_url = f"{frontend_url}/settings?tab=notifications"
    subject = morning_email_subject(len(digest.events), len(digest.positions))
    message = EmailMessage(
        to=str(user["email"]),
        subject=subject,
        body_html=render_morning_email_html(
            subject=subject,
            events=digest.events,
            positions=digest.positions,
            tz=tz,
            frontend_url=frontend_url,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        body_text=render_morning_email_text(
            subject=subject,
            events=digest.events,
            positions=digest.positions,
            tz=tz,
            frontend_url=frontend_url,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        idempotency_key=f"{NOTIFICATION_TYPE_MORNING_EMAIL}:{user_id}:{target_id}",
        headers={
            "List-Unsubscribe": f"<{unsubscribe}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
        inline_images=[EMAIL_LOGO, *digest.images],
    )
    return deliver_claimed_email(
        row_id=row_id,
        message=message,
        provider_attempts=_CONTROL.provider_attempts,
        log_context=f"notification=morning_email user={user_id}",
    )


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
