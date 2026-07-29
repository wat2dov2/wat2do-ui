"""Daily Instagram carousels, built from event data.

A batch records one scrape run - its window, school, and account - plus the
copy an admin writes and the events on the carousel, in order. That is all it
stores. Slide images are generated from the events at publish time and handed
to Meta, so the events table stays the single source of truth for everything a
slide shows.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from core.config import settings
from core.constants import (
    INSTAGRAM_BATCH_EMPTY,
    INSTAGRAM_BATCH_FAILED,
    INSTAGRAM_BATCH_GENERATING,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_PUBLISHING,
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
)
from core.controlbox import InstagramPublishingAccountControl, controlbox
from core.database import get_sb
from core.errors import (
    INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE,
    INSTAGRAM_PUBLISH_BATCH_NOT_FOUND,
    INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT,
)
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.tables import (
    EVENT_DATES,
    EVENTS,
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
)
from schemas.event import EventSummaryResponse
from schemas.instagram_publishing import (
    InstagramPublishBatchPublish,
    InstagramPublishBatchUpdate,
)
from services import event_query
from services.instagram_publishing.captions import build_caption
from services.instagram_publishing.credentials import load_account_credentials
from services.instagram_publishing.curation import select_candidate_ids
from services.instagram_publishing.meta import MetaInstagramClient
from services.instagram_publishing.rendering import render_cover_asset, render_event_asset
from services.school_context import resolve_school_timezone

log = logging.getLogger(__name__)
_CONTROL = controlbox.instagram_publishing
_SUCCESSFUL_CUTOFF_STATUSES = (
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
)
_EVENT_COLUMNS = "id,title,description,location,organization,ig_handle"


def generate_due_batches(
    now_utc: datetime | None = None,
) -> dict[str, int]:
    """Generate at most one daily review batch for each enabled account."""
    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    generation_timezone = ZoneInfo(_CONTROL.generation_timezone)
    local_now = now.astimezone(generation_timezone)

    enabled = [account for account in _CONTROL.accounts if account.enabled]
    stats = {
        "accounts": len(enabled),
        "generated": 0,
        "empty": 0,
        "skipped": 0,
        "failed": 0,
    }
    for account in enabled:
        if _batch_exists(account.key, local_now.date()):
            stats["skipped"] += 1
            continue
        try:
            outcome = _generate_account_batch(account, local_now.date(), now)
        except Exception:
            log.exception(
                "Instagram batch generation could not start account=%s",
                account.key,
            )
            stats["failed"] += 1
            continue
        stats[outcome] += 1
    return stats


def list_batches(
    *,
    batch_status: str | None,
    local_date: date | None,
    offset: int,
    limit: int,
) -> tuple[list[dict[str, Any]], int]:
    query = get_sb().table(INSTAGRAM_PUBLISH_BATCHES).select("*", count="exact")
    if batch_status:
        query = query.eq("status", batch_status)
    if local_date:
        query = query.eq("local_date", local_date.isoformat())
    response = (
        query.order("local_date", desc=True)
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    batches = response.data or []
    _hydrate_batches(batches)
    return batches, response.count or len(batches)


def get_batch(batch_id: UUID | str) -> dict[str, Any]:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select("*")
        .eq("id", str(batch_id))
        .limit(1)
        .execute()
    )
    if not response.data:
        raise NotFoundError(INSTAGRAM_PUBLISH_BATCH_NOT_FOUND)
    batch = response.data[0]
    _hydrate_batches([batch])
    return batch


def update_batch(
    batch_id: UUID | str,
    data: InstagramPublishBatchUpdate,
) -> dict[str, Any]:
    """Save the carousel the editor is holding: its events, in order, plus copy."""
    batch = get_batch(batch_id)
    _assert_version(batch, data.version)
    _assert_editable(batch)

    event_ids = list(data.event_ids)
    if len(event_ids) != len(set(event_ids)):
        raise ValidationError("Every carousel slide must be a different event")

    slide_events = _load_slide_events(event_ids)
    if any(event_id not in slide_events for event_id in event_ids):
        raise ValidationError("Every carousel slide must be a dated, existing event")

    try:
        response = (
            get_sb()
            .rpc(
                "update_instagram_publish_batch_draft",
                {
                    "p_batch_id": str(batch_id),
                    "p_expected_version": data.version,
                    "p_caption": data.caption,
                    "p_cover_body": data.cover_body,
                    "p_event_ids": event_ids,
                },
            )
            .execute()
        )
    except Exception as exc:
        _raise_draft_update_error(exc)
        raise
    if not response.data:
        raise ConflictError(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT)
    return get_batch(batch_id)


def publish_batch(
    batch_id: UUID | str,
    data: InstagramPublishBatchPublish,
) -> dict[str, Any]:
    batch = get_batch(batch_id)
    _assert_version(batch, data.version)
    _assert_editable(batch)

    account = next(
        (
            candidate
            for candidate in _CONTROL.accounts
            if candidate.enabled and candidate.key == batch["account_key"]
        ),
        None,
    )
    if account is None:
        raise ValidationError("Instagram account configuration no longer matches this batch")
    credentials = load_account_credentials(account)
    if credentials.instagram_user_id != batch["instagram_user_id"]:
        raise ValidationError("Instagram account credentials no longer match this batch")

    items = _ordered_items(batch)
    if not items:
        raise ValidationError("Instagram publishing batch has no publishable slides")

    claimed = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .update(
            {
                "status": INSTAGRAM_BATCH_PUBLISHING,
                "error_message": None,
                "version": data.version + 1,
                "updated_at": _iso_now(),
            }
        )
        .eq("id", str(batch_id))
        .eq("version", data.version)
        .in_("status", [INSTAGRAM_BATCH_READY_FOR_REVIEW, INSTAGRAM_BATCH_FAILED])
        .execute()
    )
    if not claimed.data:
        raise ConflictError(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT)

    batch.update(claimed.data[0])
    try:
        _publish_claimed_batch(credentials.access_token, batch, items)
    except Exception as exc:
        log.exception("Instagram batch %s failed to publish", batch_id)
        (
            get_sb()
            .table(INSTAGRAM_PUBLISH_BATCHES)
            .update(
                {
                    "status": INSTAGRAM_BATCH_FAILED,
                    "error_message": str(exc)[:2000],
                    "updated_at": _iso_now(),
                }
            )
            .eq("id", str(batch_id))
            .execute()
        )
        raise
    return get_batch(batch_id)


def _generate_account_batch(
    account: InstagramPublishingAccountControl,
    local_date: date,
    now: datetime,
) -> str:
    credentials = load_account_credentials(account, now_utc=now)
    window_start = _last_successful_cutoff(account.key) or (
        now - timedelta(hours=_CONTROL.fallback_window_hours)
    )
    batch_response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .insert(
            {
                "account_key": account.key,
                "instagram_user_id": credentials.instagram_user_id,
                "school": account.school,
                "local_date": local_date.isoformat(),
                "window_start": window_start.isoformat(),
                "window_end": now.isoformat(),
                "status": INSTAGRAM_BATCH_GENERATING,
                "ai_model": settings.openai_instagram_curation_model,
            }
        )
        .execute()
    )
    if not batch_response.data:
        raise RuntimeError(f"Could not create Instagram batch for {account.key}")
    batch = batch_response.data[0]

    try:
        candidates = _load_candidates(
            account_key=account.key,
            school=account.school,
            window_start=window_start,
            window_end=now,
        )
        if not candidates:
            _complete_empty_batch(batch["id"])
            return "empty"

        candidate_ids = select_candidate_ids(
            candidates,
            maximum_count=_CONTROL.maximum_event_slides,
        )
        candidates_by_id = {int(candidate["id"]): candidate for candidate in candidates}
        selected = [candidates_by_id[event_id] for event_id in candidate_ids]
        if not selected:
            _complete_empty_batch(batch["id"])
            return "empty"

        item_rows = [
            {
                "batch_id": batch["id"],
                "account_key": account.key,
                "event_id": candidate["id"],
                "position": position,
            }
            for position, candidate in enumerate(selected, start=1)
        ]
        get_sb().table(INSTAGRAM_PUBLISH_ITEMS).insert(item_rows).execute()
        (
            get_sb()
            .table(INSTAGRAM_PUBLISH_BATCHES)
            .update(
                {
                    "status": INSTAGRAM_BATCH_READY_FOR_REVIEW,
                    "caption": build_caption(selected, account.school),
                    "error_message": None,
                    "updated_at": _iso_now(),
                }
            )
            .eq("id", batch["id"])
            .execute()
        )
        return "generated"
    except Exception as exc:
        log.exception("Instagram batch generation failed for account=%s", account.key)
        (
            get_sb()
            .table(INSTAGRAM_PUBLISH_BATCHES)
            .update(
                {
                    "status": INSTAGRAM_BATCH_FAILED,
                    "error_message": str(exc)[:2000],
                    "updated_at": _iso_now(),
                }
            )
            .eq("id", batch["id"])
            .execute()
        )
        return "failed"


def _load_candidates(
    *,
    account_key: str,
    school: str,
    window_start: datetime,
    window_end: datetime,
) -> list[dict[str, Any]]:
    events_response = (
        get_sb()
        .table(EVENTS)
        .select(_EVENT_COLUMNS)
        .eq("school", school)
        .eq("cancelled", False)
        .gte("added_at", window_start.isoformat())
        .lt("added_at", window_end.isoformat())
        .order("added_at", desc=True)
        .limit(_CONTROL.maximum_ai_candidates * 3)
        .execute()
    )
    events = events_response.data or []
    if not events:
        return []

    event_ids = [int(event["id"]) for event in events]
    published = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("event_id")
        .eq("account_key", account_key)
        .in_("event_id", event_ids)
        .not_.is_("published_at", "null")
        .execute()
    ).data or []
    published_ids = {int(row["event_id"]) for row in published}

    occurrence_start = window_end + timedelta(hours=_CONTROL.minimum_lead_hours)
    occurrence_end = window_end + timedelta(days=_CONTROL.maximum_lead_days)
    occurrences = (
        get_sb()
        .table(EVENT_DATES)
        .select("event_id,dtstart_utc,dtend_utc,tz")
        .in_("event_id", event_ids)
        .gte("dtstart_utc", occurrence_start.isoformat())
        .lte("dtstart_utc", occurrence_end.isoformat())
        .order("dtstart_utc")
        .execute()
    ).data or []
    first_occurrence: dict[int, dict[str, Any]] = {}
    for occurrence in occurrences:
        first_occurrence.setdefault(int(occurrence["event_id"]), occurrence)

    candidates = []
    for event in events:
        event_id = int(event["id"])
        occurrence = first_occurrence.get(event_id)
        if event_id in published_ids or occurrence is None:
            continue
        candidates.append(_with_occurrence(event, occurrence, school))
    candidates.sort(key=lambda event: (event["dtstart_utc"], -event["id"]))
    return candidates[: _CONTROL.maximum_ai_candidates]


def _load_slide_events(event_ids: list[int]) -> dict[int, EventSummaryResponse]:
    """Current event data for the given slides, keyed by event id.

    A slide is a function of its event, so this is read fresh every time the
    carousel is shown or published, through the same hydration the browse list
    uses. Events without any occurrence are omitted: a slide has nowhere to
    print a date.
    """
    events = event_query.load_events_by_ids(event_ids, model=EventSummaryResponse)
    return {event_id: event for event_id, event in events.items() if event.occurrences}


def _slide_payload(event: EventSummaryResponse) -> dict[str, Any]:
    """Flatten a hydrated event into the dict the slide renderer reads.

    A recurring event advertises its first occurrence - the same one the editor
    previews, since both read the server's ascending occurrence order. Slides
    print local times and the renderer only ever sees this dict, so the zone is
    resolved here rather than teaching the renderer the school-to-timezone map.
    """
    occurrence = event.occurrences[0]
    return {
        **event.model_dump(exclude={"occurrences"}),
        "dtstart_utc": occurrence.dtstart_utc.isoformat(),
        "dtend_utc": occurrence.dtend_utc.isoformat() if occurrence.dtend_utc else None,
        "tz": occurrence.tz or resolve_school_timezone(event.school),
    }


def _with_occurrence(
    event: dict[str, Any],
    occurrence: dict[str, Any],
    school: str | None,
) -> dict[str, Any]:
    """Flatten the occurrence a slide prints onto its event."""
    return {
        **event,
        "id": int(event["id"]),
        "dtstart_utc": occurrence["dtstart_utc"],
        "dtend_utc": occurrence.get("dtend_utc"),
        # Slides print local times, and the renderer only ever sees this dict -
        # so resolve the zone here instead of teaching the frontend the
        # school-to-timezone map.
        "tz": occurrence.get("tz") or resolve_school_timezone(school),
    }


def _publish_claimed_batch(
    access_token: str,
    batch: dict[str, Any],
    items: list[dict[str, Any]],
) -> None:
    """Render the carousel from event data, then post it.

    Rendering happens here, once, because the image is not the carousel - the
    events are. Whatever they say at this moment is what Instagram receives.
    """
    client = MetaInstagramClient(access_token)
    user_id = batch["instagram_user_id"]
    batch_id = batch["id"]
    events = [_slide_payload(item["event"]) for item in items]

    cover_url = render_cover_asset(
        events,
        batch["school"],
        batch["cover_body"],
        local_date=str(batch["local_date"]),
        new_event_count=int(batch.get("new_event_count") or 0),
    )
    cover_container_id = client.create_image_container(user_id, cover_url)
    client.wait_until_ready(cover_container_id)

    child_ids = [cover_container_id]
    asset_urls: dict[int, str] = {}
    for event in events:
        asset_url = render_event_asset(event)
        asset_urls[int(event["id"])] = asset_url
        child_id = client.create_image_container(user_id, asset_url)
        client.wait_until_ready(child_id)
        child_ids.append(child_id)

    carousel_id = client.create_carousel_container(
        user_id,
        child_ids=child_ids,
        caption=batch["caption"],
    )
    client.wait_until_ready(carousel_id)
    media_id = client.publish(user_id, carousel_id)
    published_at = _iso_now()
    # The slides are now history: the events behind them keep changing, so a
    # published batch shows the PNGs that were posted rather than re-rendering.
    for item in items:
        (
            get_sb()
            .table(INSTAGRAM_PUBLISH_ITEMS)
            .update(
                {
                    "published_at": published_at,
                    "published_asset_url": asset_urls.get(int(item["event_id"])),
                    "updated_at": published_at,
                }
            )
            .eq("id", str(item["id"]))
            .execute()
        )
    _update_batch_fields(
        batch_id,
        {
            "status": INSTAGRAM_BATCH_PUBLISHED,
            "meta_media_id": media_id,
            "published_cover_url": cover_url,
            "published_at": published_at,
            "updated_at": published_at,
            "error_message": None,
        },
    )


def _hydrate_batches(batches: list[dict[str, Any]]) -> None:
    """Fill in everything a batch response carries beyond its own row."""
    _attach_items(batches)
    for batch in batches:
        batch["new_event_count"] = _count_new_events(batch)


def _count_new_events(batch: dict[str, Any]) -> int:
    """Count recent school events plus the current carousel, without duplicates.

    The recent window ends at the batch's immutable ``window_end`` so its time
    boundary does not drift while the batch waits for review. Carousel events
    are included even when they were added before that window because the
    cover must never claim fewer events than the carousel contains.
    """
    window_end = _parse_datetime(batch["window_end"])
    window_start = window_end - timedelta(hours=_CONTROL.new_event_window_hours)
    carousel_event_ids = {int(item["event_id"]) for item in batch.get("items", [])}

    recent_count = _count_active_events_added_between(
        school=batch["school"],
        window_start=window_start,
        window_end=window_end,
    )
    if not carousel_event_ids:
        return recent_count

    carousel_overlap_count = _count_active_events_added_between(
        school=batch["school"],
        window_start=window_start,
        window_end=window_end,
        event_ids=carousel_event_ids,
    )
    return recent_count + len(carousel_event_ids) - carousel_overlap_count


def _count_active_events_added_between(
    *,
    school: str,
    window_start: datetime,
    window_end: datetime,
    event_ids: set[int] | None = None,
) -> int:
    query = (
        get_sb()
        .table(EVENTS)
        .select("id", count="exact")
        .eq("school", school)
        .eq("cancelled", False)
        .gte("added_at", window_start.isoformat())
        .lt("added_at", window_end.isoformat())
    )
    if event_ids is not None:
        query = query.in_("id", sorted(event_ids))
    response = query.limit(1).execute()
    return response.count or 0


def _attach_items(batches: list[dict[str, Any]]) -> None:
    """Attach each batch's slides, ordered, with their event data joined on."""
    if not batches:
        return
    batch_ids = [str(batch["id"]) for batch in batches]
    items = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("*")
        .in_("batch_id", batch_ids)
        .order("position")
        .execute()
    ).data or []

    slide_events = _load_slide_events([int(item["event_id"]) for item in items])
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in items:
        event = slide_events.get(int(item["event_id"]))
        if event is None:
            continue
        grouped[str(item["batch_id"])].append({**item, "event": event})
    for batch in batches:
        batch["items"] = grouped.get(str(batch["id"]), [])


def _ordered_items(batch: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(batch["items"], key=lambda item: int(item["position"]))


def _batch_exists(account_key: str, local_date: date) -> bool:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select("id")
        .eq("account_key", account_key)
        .eq("local_date", local_date.isoformat())
        .limit(1)
        .execute()
    )
    return bool(response.data)


def _last_successful_cutoff(account_key: str) -> datetime | None:
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .select("window_end")
        .eq("account_key", account_key)
        .in_("status", list(_SUCCESSFUL_CUTOFF_STATUSES))
        .order("window_end", desc=True)
        .limit(1)
        .execute()
    )
    if not response.data:
        return None
    return _parse_datetime(response.data[0]["window_end"])


def _complete_empty_batch(batch_id: str) -> None:
    (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .update(
            {
                "status": INSTAGRAM_BATCH_EMPTY,
                "error_message": None,
                "updated_at": _iso_now(),
            }
        )
        .eq("id", batch_id)
        .execute()
    )


def _update_batch_fields(batch_id: str, fields: dict[str, Any]) -> None:
    get_sb().table(INSTAGRAM_PUBLISH_BATCHES).update(fields).eq("id", batch_id).execute()


def _assert_version(batch: dict[str, Any], expected: int) -> None:
    if int(batch["version"]) != expected:
        raise ConflictError(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT)


def _assert_editable(batch: dict[str, Any]) -> None:
    if batch["status"] not in {INSTAGRAM_BATCH_READY_FOR_REVIEW, INSTAGRAM_BATCH_FAILED}:
        raise ValidationError(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE)


def _raise_draft_update_error(exc: Exception) -> None:
    message = str(exc).lower()
    if "version conflict" in message:
        raise ConflictError(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT) from exc
    if "not found" in message:
        raise NotFoundError(INSTAGRAM_PUBLISH_BATCH_NOT_FOUND) from exc
    if "not editable" in message:
        raise ValidationError(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE) from exc
    raise exc


def _aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        raise ValueError("now_utc must be timezone-aware")
    return value.astimezone(timezone.utc)


def _parse_datetime(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return _aware_utc(value)
    return _aware_utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()
