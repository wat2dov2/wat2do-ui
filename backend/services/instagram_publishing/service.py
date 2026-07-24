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
    INSTAGRAM_PUBLISHING_NOT_CONFIGURED,
)
from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.tables import (
    EVENT_DATES,
    EVENTS,
    INSTAGRAM_PUBLISH_BATCHES,
    INSTAGRAM_PUBLISH_ITEMS,
)
from schemas.instagram_publishing import (
    InstagramPublishBatchPublish,
    InstagramPublishBatchUpdate,
)
from services.instagram_publishing.captions import build_caption
from services.instagram_publishing.curation import rank_candidates
from services.instagram_publishing.meta import MetaInstagramClient
from services.instagram_publishing.rendering import render_cover_asset, render_event_asset

log = logging.getLogger(__name__)
_CONTROL = controlbox.instagram_publishing
_SUCCESSFUL_CUTOFF_STATUSES = (
    INSTAGRAM_BATCH_READY_FOR_REVIEW,
    INSTAGRAM_BATCH_PUBLISHED,
    INSTAGRAM_BATCH_EMPTY,
)


def generate_due_batches(
    now_utc: datetime | None = None,
    *,
    force: bool = False,
) -> dict[str, int]:
    """Generate at most one daily review batch for each enabled account."""
    now = _aware_utc(now_utc or datetime.now(timezone.utc))
    generation_timezone = ZoneInfo(_CONTROL.generation_timezone)
    local_now = now.astimezone(generation_timezone)
    if not force and local_now.hour != _CONTROL.generation_local_hour:
        return {"accounts": 0, "generated": 0, "empty": 0, "skipped": 0, "failed": 0}

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
        outcome = _generate_account_batch(account, local_now.date(), now)
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
    _attach_items(batches)
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
    _attach_items([batch])
    return batch


def update_batch(
    batch_id: UUID | str,
    data: InstagramPublishBatchUpdate,
) -> dict[str, Any]:
    batch = get_batch(batch_id)
    _assert_version(batch, data.version)
    if batch["status"] not in {INSTAGRAM_BATCH_READY_FOR_REVIEW, INSTAGRAM_BATCH_FAILED}:
        raise ValidationError(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE)

    items_by_id = {str(item["id"]): item for item in batch["items"]}
    selected_ids = [str(item_id) for item_id in data.item_ids]
    if len(selected_ids) != len(set(selected_ids)) or any(
        item_id not in items_by_id for item_id in selected_ids
    ):
        raise ValidationError("Every selected Instagram item must belong to the batch")

    selected_events = [items_by_id[item_id]["event_snapshot"] for item_id in selected_ids]
    cover_url = render_cover_asset(selected_events, batch["school"])
    try:
        response = (
            get_sb()
            .rpc(
                "update_instagram_publish_batch_draft",
                {
                    "p_batch_id": str(batch_id),
                    "p_expected_version": data.version,
                    "p_caption": data.caption,
                    "p_item_ids": selected_ids,
                    "p_cover_image_url": cover_url,
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
    access_token = _publishing_access_token()
    batch = get_batch(batch_id)
    _assert_version(batch, data.version)
    if batch["status"] not in {INSTAGRAM_BATCH_READY_FOR_REVIEW, INSTAGRAM_BATCH_FAILED}:
        raise ValidationError(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE)

    account = next(
        (
            candidate
            for candidate in _CONTROL.accounts
            if candidate.enabled and candidate.key == batch["account_key"]
        ),
        None,
    )
    if account is None or account.instagram_business_account_id != batch["instagram_user_id"]:
        raise ValidationError("Instagram account configuration no longer matches this batch")

    included = _included_items(batch)
    if not included or not batch.get("cover_image_url"):
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
        _publish_claimed_batch(access_token, batch, included)
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
    window_start = _last_successful_cutoff(account.key) or (
        now - timedelta(hours=_CONTROL.fallback_window_hours)
    )
    batch_response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .insert(
            {
                "account_key": account.key,
                "instagram_user_id": account.instagram_business_account_id,
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

        scores = rank_candidates(candidates)
        selected = _select_events(candidates, scores)
        if not selected:
            _complete_empty_batch(batch["id"])
            return "empty"

        rendered: list[tuple[dict[str, Any], dict[str, Any], str]] = []
        for candidate, score in selected:
            try:
                rendered.append((candidate, score, render_event_asset(candidate)))
            except Exception:
                log.exception(
                    "Could not render Instagram asset for event=%s batch=%s",
                    candidate["id"],
                    batch["id"],
                )
        if not rendered:
            raise RuntimeError("No selected event image could be rendered")

        events = [candidate for candidate, _, _ in rendered]
        cover_url = render_cover_asset(events, account.school)
        caption = build_caption(events, account.school)
        item_rows = []
        for position, (candidate, score, asset_url) in enumerate(rendered, start=1):
            item_rows.append(
                {
                    "batch_id": batch["id"],
                    "account_key": account.key,
                    "event_id": candidate["id"],
                    "position": position,
                    "included": True,
                    "event_snapshot": candidate,
                    **score,
                    "asset_url": asset_url,
                }
            )
        get_sb().table(INSTAGRAM_PUBLISH_ITEMS).insert(item_rows).execute()
        (
            get_sb()
            .table(INSTAGRAM_PUBLISH_BATCHES)
            .update(
                {
                    "status": INSTAGRAM_BATCH_READY_FOR_REVIEW,
                    "caption": caption,
                    "cover_image_url": cover_url,
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
        .select(
            "id,title,description,location,price,food,registration,"
            "source_image_url,source_url,category,organization,ig_handle,school,added_at"
        )
        .eq("school", school)
        .eq("ingestion_source", "instagram_scraper")
        .eq("cancelled", False)
        .not_.is_("source_image_url", "null")
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
        candidates.append(
            {
                **event,
                "id": event_id,
                "dtstart_utc": occurrence["dtstart_utc"],
                "dtend_utc": occurrence.get("dtend_utc"),
                "tz": occurrence.get("tz"),
            }
        )
    candidates.sort(key=lambda event: (event["dtstart_utc"], -event["id"]))
    return candidates[: _CONTROL.maximum_ai_candidates]


def _select_events(
    candidates: list[dict[str, Any]],
    scores: list[dict[str, Any]],
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    candidates_by_id = {int(candidate["id"]): candidate for candidate in candidates}
    ranked = sorted(
        scores,
        key=lambda score: (
            -float(score["overall_score"]),
            candidates_by_id[int(score["event_id"])]["dtstart_utc"],
        ),
    )
    selected = []
    per_organization: dict[str, int] = defaultdict(int)
    for score in ranked:
        if float(score["overall_score"]) < _CONTROL.minimum_ai_score:
            continue
        candidate = candidates_by_id[int(score["event_id"])]
        organization_key = str(
            candidate.get("organization") or candidate.get("ig_handle") or candidate["id"]
        ).casefold()
        if per_organization[organization_key] >= 2:
            continue
        per_organization[organization_key] += 1
        selected.append((candidate, score))
        if len(selected) >= _CONTROL.maximum_event_slides:
            break
    return selected


def _publish_claimed_batch(
    access_token: str,
    batch: dict[str, Any],
    items: list[dict[str, Any]],
) -> None:
    client = MetaInstagramClient(access_token)
    user_id = batch["instagram_user_id"]
    batch_id = batch["id"]

    cover_container_id = batch.get("meta_cover_container_id")
    if not cover_container_id:
        cover_container_id = client.create_image_container(user_id, batch["cover_image_url"])
        _update_batch_fields(batch_id, {"meta_cover_container_id": cover_container_id})
    client.wait_until_ready(cover_container_id)

    child_ids = [cover_container_id]
    for item in items:
        child_id = item.get("meta_container_id")
        if not child_id:
            child_id = client.create_image_container(user_id, item["asset_url"])
            (
                get_sb()
                .table(INSTAGRAM_PUBLISH_ITEMS)
                .update({"meta_container_id": child_id, "updated_at": _iso_now()})
                .eq("id", item["id"])
                .execute()
            )
        client.wait_until_ready(child_id)
        child_ids.append(child_id)

    carousel_id = batch.get("meta_carousel_container_id")
    if not carousel_id:
        carousel_id = client.create_carousel_container(
            user_id,
            child_ids=child_ids,
            caption=batch["caption"],
        )
        _update_batch_fields(batch_id, {"meta_carousel_container_id": carousel_id})
    client.wait_until_ready(carousel_id)
    media_id = client.publish(user_id, carousel_id)
    published_at = _iso_now()
    (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .update({"published_at": published_at, "updated_at": published_at})
        .eq("batch_id", batch_id)
        .eq("included", True)
        .execute()
    )
    _update_batch_fields(
        batch_id,
        {
            "status": INSTAGRAM_BATCH_PUBLISHED,
            "meta_media_id": media_id,
            "published_at": published_at,
            "updated_at": published_at,
            "error_message": None,
        },
    )


def _attach_items(batches: list[dict[str, Any]]) -> None:
    if not batches:
        return
    batch_ids = [str(batch["id"]) for batch in batches]
    response = (
        get_sb()
        .table(INSTAGRAM_PUBLISH_ITEMS)
        .select("*")
        .in_("batch_id", batch_ids)
        .order("included", desc=True)
        .order("position")
        .order("overall_score", desc=True)
        .execute()
    )
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in response.data or []:
        grouped[str(item["batch_id"])].append(item)
    for batch in batches:
        batch["items"] = grouped.get(str(batch["id"]), [])


def _included_items(batch: dict[str, Any]) -> list[dict[str, Any]]:
    return sorted(
        (item for item in batch["items"] if item["included"]),
        key=lambda item: int(item["position"]),
    )


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


def _raise_draft_update_error(exc: Exception) -> None:
    message = str(exc).lower()
    if "version conflict" in message:
        raise ConflictError(INSTAGRAM_PUBLISH_BATCH_VERSION_CONFLICT) from exc
    if "not found" in message:
        raise NotFoundError(INSTAGRAM_PUBLISH_BATCH_NOT_FOUND) from exc
    if "not editable" in message:
        raise ValidationError(INSTAGRAM_PUBLISH_BATCH_NOT_EDITABLE) from exc
    raise exc


def _publishing_access_token() -> str:
    if not settings.instagram_access_token:
        raise ValidationError(INSTAGRAM_PUBLISHING_NOT_CONFIGURED)
    return settings.instagram_access_token


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
