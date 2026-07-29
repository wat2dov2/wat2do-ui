"""Batched composition and isolated delivery of the 9 AM morning email."""

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from core.config import settings
from core.constants import NOTIFICATION_TYPE_MORNING_EMAIL
from core.controlbox import controlbox
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import EVENT_DATES, EVENTS, USER_GOING_EVENTS, USERS
from recommender.service import get_stored_recommendations_for_users
from services import school_service
from services.email_service import EmailMessage
from services.notifications.delivery_log import (
    claim_delivery,
    deliver_claimed_email,
)
from services.notifications.preferences import get_enabled_user_ids
from services.notifications.rendering import (
    morning_email_subject,
    render_morning_email_html,
    render_morning_email_text,
)
from services.notifications.unsubscribe import unsubscribe_url
from services.school_context import resolve_user_timezone

log = logging.getLogger(__name__)

_CONTROL = controlbox.morning_email
_CONTENT_WINDOW = timedelta(hours=_CONTROL.new_event_window_hours)
_MIN_RECOMMENDATION_SCORE = _CONTROL.minimum_recommendation_score
_CHUNK_SIZE = 500


def dispatch_morning_emails(now_utc: datetime) -> dict[str, int]:
    """Compose all eligible users from batched reads, then send independently."""
    window_end = _aware_utc(now_utc)
    users = _eligible_users(_fetch_users(), window_end)
    if not users:
        return {"eligible": 0, "prepared": 0, "sent": 0, "failed": 0, "skipped": 0}

    user_ids = [str(user["id"]) for user in users]
    enabled_ids = get_enabled_user_ids(user_ids, NOTIFICATION_TYPE_MORNING_EMAIL)
    users = [user for user in users if str(user["id"]) in enabled_ids]
    if not users:
        return {"eligible": 0, "prepared": 0, "sent": 0, "failed": 0, "skipped": 0}

    user_ids = [str(user["id"]) for user in users]
    candidates_by_school = _load_candidates_by_school(users, window_end)
    stored_by_user = get_stored_recommendations_for_users(user_ids)
    candidate_ids = sorted(
        {int(event["id"]) for events in candidates_by_school.values() for event in events}
    )
    exclusions = _load_going_exclusions(user_ids, candidate_ids)

    prepared = 0
    sent = 0
    failed = 0
    skipped = 0
    for user in users:
        user_id = str(user["id"])
        picks = _select_picks(
            user=user,
            candidates_by_school=candidates_by_school,
            stored=stored_by_user.get(user_id, []),
            excluded_event_ids=exclusions.get(user_id, set()),
        )
        if not picks:
            continue

        prepared += 1
        delivery_result = _send_prepared_email(
            user=user,
            picks=picks,
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


def _load_candidates_by_school(
    users: list[dict],
    window_end: datetime,
) -> dict[str, list[dict]]:
    schools = sorted({str(user["school"]) for user in users if user.get("school")})
    earliest_start = window_end - _CONTENT_WINDOW
    candidates: dict[str, list[dict]] = {}
    for school in schools:
        school_id = school_service.get_school_id(school)
        if school_id is None:
            candidates[school] = []
            continue
        rows = fetch_all_pages(
            lambda offset, page_size: (
                (
                    get_sb()
                    .table(EVENTS)
                    .select(
                        "id,title,location,source_image_url,organization,"
                        "category,added_at,cancelled"
                    )
                    .eq("school_id", school_id)
                    .eq("cancelled", False)
                    .gt("added_at", earliest_start.isoformat())
                    .lte("added_at", window_end.isoformat())
                    .order("added_at", desc=True)
                    .order("id")
                    .range(offset, offset + page_size - 1)
                    .execute()
                ).data
                or []
            )
        )
        for row in rows:
            row["school"] = school
        by_id = {int(row["id"]): row for row in rows}
        if not by_id:
            candidates[school] = []
            continue

        earliest_occurrence: dict[int, dict] = {}
        for event_id_chunk in _chunks(list(by_id)):
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

        hydrated: list[dict] = []
        for event_id, event in by_id.items():
            occurrence = earliest_occurrence.get(event_id)
            if occurrence is None:
                continue
            item = dict(event)
            item["dtstart_utc"] = occurrence["dtstart_utc"]
            item["dtend_utc"] = occurrence.get("dtend_utc")
            hydrated.append(item)
        candidates[school] = hydrated
    return candidates


def _load_going_exclusions(
    user_ids: list[str],
    candidate_ids: list[int],
) -> dict[str, set[int]]:
    excluded: dict[str, set[int]] = defaultdict(set)
    for user_chunk in _chunks(user_ids):
        for event_chunk in _chunks(candidate_ids):
            rows = (
                get_sb()
                .table(USER_GOING_EVENTS)
                .select("user_id,event_id")
                .in_("user_id", user_chunk)
                .in_("event_id", event_chunk)
                .execute()
            ).data or []
            for row in rows:
                excluded[str(row["user_id"])].add(int(row["event_id"]))
    return excluded


def _select_picks(
    *,
    user: dict,
    candidates_by_school: dict[str, list[dict]],
    stored: list[dict],
    excluded_event_ids: set[int],
) -> list[dict]:
    school = user.get("school")
    if not school:
        return []
    by_id = {
        int(event["id"]): event
        for event in candidates_by_school.get(str(school), [])
        if int(event["id"]) not in excluded_event_ids
    }
    selected: list[dict] = []
    for recommendation in stored:
        event_id = int(recommendation["event_id"])
        score = float(recommendation["predicted_score"])
        if score >= _MIN_RECOMMENDATION_SCORE and event_id in by_id:
            selected.append(by_id[event_id])
    return selected


def _send_prepared_email(
    *,
    user: dict,
    picks: list[dict],
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

    unsubscribe = unsubscribe_url(user_id, NOTIFICATION_TYPE_MORNING_EMAIL)
    preferences_url = f"{settings.frontend_url.rstrip('/')}/settings?tab=notifications"
    subject = morning_email_subject(len(picks))
    message = EmailMessage(
        to=str(user["email"]),
        subject=subject,
        body_html=render_morning_email_html(
            subject=subject,
            picks=picks,
            tz=tz,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        body_text=render_morning_email_text(
            subject=subject,
            picks=picks,
            tz=tz,
            preferences_url=preferences_url,
            unsubscribe_url=unsubscribe,
        ),
        idempotency_key=f"{NOTIFICATION_TYPE_MORNING_EMAIL}:{user_id}:{target_id}",
        headers={
            "List-Unsubscribe": f"<{unsubscribe}>",
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
    )
    return deliver_claimed_email(
        row_id=row_id,
        message=message,
        provider_attempts=_CONTROL.provider_attempts,
        log_context=f"notification=morning_email user={user_id}",
    )


def _chunks(values: list[Any]) -> list[list[Any]]:
    return [values[start : start + _CHUNK_SIZE] for start in range(0, len(values), _CHUNK_SIZE)]


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)
