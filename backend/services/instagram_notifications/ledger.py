"""Durable media claims and browser delivery receipts for Instagram sources."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Literal, Sequence
from uuid import UUID

from core.constants import INSTAGRAM_BATCH_PUBLISHED
from core.database import get_sb
from core.pagination import fetch_all_pages
from core.tables import INSTAGRAM_NOTIFICATION_MEDIA, INSTAGRAM_PUBLISH_BATCHES
from services.instagram_notifications.browser_session import BrowserSessionError, canonical_post_url


def validate_browser_sources(value: Any) -> list[dict[str, Any]]:
    """Validate the immutable public source selection carried by a delivery receipt."""
    if not isinstance(value, list):
        raise ValueError("Carousel delivery sources must be a list")
    sources = []
    for source in value:
        if (
            not isinstance(source, dict)
            or set(source) != {"post_url", "event_id"}
            or not isinstance(source["post_url"], str)
            or source["event_id"] is not None
            and (type(source["event_id"]) is not int or source["event_id"] <= 0)
        ):
            raise ValueError("Carousel delivery source is invalid")
        try:
            post_url = canonical_post_url(source["post_url"])
        except BrowserSessionError:
            raise ValueError("Carousel delivery post URL is invalid") from None
        if post_url != source["post_url"]:
            raise ValueError("Carousel delivery post URL is not canonical")
        sources.append({"post_url": post_url, "event_id": source["event_id"]})
    return sources


def freeze_browser_sources(*, batch_id: str, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Adopt the database's immutable winner before any local engagement is queued."""
    response = (
        get_sb()
        .rpc(
            "freeze_instagram_browser_sources",
            {"p_batch_id": str(UUID(batch_id)), "p_sources": validate_browser_sources(sources)},
        )
        .execute()
    )
    return validate_browser_sources(response.data)


def acknowledge_browser_delivery(
    *,
    table: str,
    row_id: str,
    delivery_generation: str,
    sources: list[dict[str, Any]] | None = None,
) -> None:
    """Record delivery only after the source has committed to its local queue.

    This receipt is independent of processing or engagement completion.
    A recreated queue uses a new generation and discovers the source again.
    """
    status = {
        INSTAGRAM_NOTIFICATION_MEDIA: "pending",
        INSTAGRAM_PUBLISH_BATCHES: INSTAGRAM_BATCH_PUBLISHED,
    }[table]
    receipt: dict[str, Any] = {"browser_delivery_generation": str(UUID(delivery_generation))}
    if table == INSTAGRAM_PUBLISH_BATCHES:
        if sources is None:
            raise ValueError("Published carousel delivery requires its frozen sources")
        receipt["browser_delivery_sources"] = validate_browser_sources(sources)
    elif sources is not None:
        raise ValueError("Notification media delivery does not contain carousel sources")
    (
        get_sb()
        .table(table)
        .update(receipt, returning="minimal")
        .eq("id", str(UUID(row_id)))
        .eq("status", status)
        .execute()
    )


def recover_finished_media_claims(is_run_completed: Callable[[str], bool]) -> int:
    """Release abandoned claims only after their owning workflow has completed.

    Snapshot before changing rows so pagination cannot skip released claims.
    Claim tokens protect against a worker that has already reclaimed the item.
    """

    def page(offset: int, page_size: int) -> list[dict]:
        return (
            get_sb()
            .table(INSTAGRAM_NOTIFICATION_MEDIA)
            .select("id,claim_token,github_run_id")
            .eq("status", "processing")
            .order("id")
            .range(offset, offset + page_size - 1)
            .execute()
            .data
            or []
        )

    rows = fetch_all_pages(page)
    completed: dict[str, bool] = {}
    recovered = 0
    for row in rows:
        run_id = row.get("github_run_id")
        if not isinstance(run_id, str) or not run_id.isdecimal():
            continue
        if run_id not in completed:
            completed[run_id] = is_run_completed(run_id)
        if completed[run_id] and rollback_media_claim(
            media_row_id=str(row["id"]), claim_token=str(row["claim_token"])
        ):
            recovered += 1
    return recovered


@dataclass(frozen=True)
class MaterializedMedia:
    """One exact Instagram media target recovered from a notification."""

    media_id: str
    source_url: str


@dataclass(frozen=True)
class MediaClaim:
    """Irreversible processing claim for one materialized media item."""

    media_row_id: str
    source_url: str
    claim_token: str
    intended_recipient_id: str


def record_notification_media(
    *,
    school_id: int,
    intended_recipient_id: str,
    push_id: str,
    push_category: str,
    cache_ent_id: str | None,
    total_non_mmc_media_count: int | None,
    media: Sequence[MaterializedMedia],
) -> tuple[str, int]:
    """Record one notification and its recovered media without claiming work."""

    normalized_media = _deduplicate_media(media)
    response = (
        get_sb()
        .rpc(
            "record_instagram_notification_media",
            {
                "p_school_id": school_id,
                "p_intended_recipient_id": intended_recipient_id.strip(),
                "p_push_id": push_id.strip(),
                "p_push_category": push_category.strip(),
                "p_cache_ent_id": _optional_text(cache_ent_id),
                "p_total_non_mmc_media_count": total_non_mmc_media_count,
                "p_media": [
                    {"media_id": item.media_id, "source_url": item.source_url}
                    for item in normalized_media
                ],
            },
        )
        .execute()
    )
    rows = response.data or []
    if not rows:
        raise RuntimeError("Instagram notification ledger returned no record ID")

    notification_id = rows[0].get("notification_id")
    newly_inserted_count = rows[0].get("newly_inserted_count", 0)

    if not isinstance(notification_id, str) or not notification_id:
        raise RuntimeError("Instagram notification ledger returned no record ID")

    return notification_id, newly_inserted_count


def claim_next_notification_media(
    *,
    notification_id: str,
    github_run_id: str | None,
) -> MediaClaim | None:
    """Irreversibly claim only the next pending media item immediately before use."""

    response = (
        get_sb()
        .rpc(
            "claim_next_instagram_notification_media",
            {
                "p_notification_id": notification_id,
                "p_github_run_id": _optional_text(github_run_id),
            },
        )
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None
    row = rows[0]
    return MediaClaim(
        media_row_id=str(row["media_row_id"]),
        source_url=str(row["source_url"]),
        claim_token=str(row["claim_token"]),
        intended_recipient_id=str(row["intended_recipient_id"]),
    )


def claim_next_pending_media(
    *,
    github_run_id: str | None,
) -> MediaClaim | None:
    """Irreversibly claim the next globally pending media item immediately before use."""

    response = (
        get_sb()
        .rpc(
            "claim_next_pending_instagram_media",
            {
                "p_github_run_id": _optional_text(github_run_id),
            },
        )
        .execute()
    )
    rows = response.data or []
    if not rows:
        return None
    row = rows[0]
    return MediaClaim(
        media_row_id=str(row["media_row_id"]),
        source_url=str(row["source_url"]),
        claim_token=str(row["claim_token"]),
        intended_recipient_id=str(row["intended_recipient_id"]),
    )


def mark_media_succeeded(*, media_row_id: str, claim_token: str) -> bool:
    """Commit success only while the irreversible claim is still processing."""
    return _finalize_media(
        media_row_id=media_row_id,
        claim_token=claim_token,
        status="succeeded",
        failure_category=None,
    )


def mark_media_failed(
    *,
    media_row_id: str,
    claim_token: str,
    failure_category: str,
) -> bool:
    """Commit a sanitized terminal failure while the caller owns the claim."""
    category = failure_category.strip()
    if not category:
        raise ValueError("failure_category cannot be empty")
    return _finalize_media(
        media_row_id=media_row_id,
        claim_token=claim_token,
        status="failed",
        failure_category=category,
    )


def rollback_media_claim(
    *,
    media_row_id: str,
    claim_token: str,
) -> bool:
    """Release a claim back to pending for a transient infrastructure failure."""
    response = (
        get_sb()
        .rpc(
            "rollback_instagram_notification_media",
            {
                "p_media_row_id": media_row_id,
                "p_claim_token": claim_token,
            },
        )
        .execute()
    )
    return response.data is True


def _finalize_media(
    *,
    media_row_id: str,
    claim_token: str,
    status: Literal["succeeded", "failed"],
    failure_category: str | None,
) -> bool:
    response = (
        get_sb()
        .rpc(
            "finalize_instagram_notification_media",
            {
                "p_media_row_id": media_row_id,
                "p_claim_token": claim_token,
                "p_status": status,
                "p_failure_category": failure_category,
            },
        )
        .execute()
    )
    return response.data is True


def _deduplicate_media(media: Sequence[MaterializedMedia]) -> list[MaterializedMedia]:
    deduplicated: dict[str, MaterializedMedia] = {}
    for item in media:
        normalized = MaterializedMedia(
            media_id=item.media_id.strip(),
            source_url=item.source_url.strip(),
        )
        existing = deduplicated.get(normalized.media_id)
        if existing is not None and existing.source_url != normalized.source_url:
            raise ValueError("A media ID cannot resolve to multiple source URLs")
        deduplicated.setdefault(normalized.media_id, normalized)
    return list(deduplicated.values())


def _optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def claim_pending_browser_media(*, media_row_id: str, claim_token: str) -> bool:
    """Claim one retrieved row with a token journaled by the local importer first.

    Conditional UPDATE is atomic against the existing RPC claimers. Persisting
    the caller-generated token before this request covers a crash even when the
    database committed but the client never received its response.
    """
    from datetime import datetime, timezone
    from uuid import UUID

    UUID(media_row_id)
    UUID(claim_token)
    response = (
        get_sb()
        .table(INSTAGRAM_NOTIFICATION_MEDIA)
        .update(
            {
                "status": "processing",
                "claim_token": claim_token,
                "github_run_id": None,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("id", media_row_id)
        .eq("status", "pending")
        .execute()
    )
    return bool(response.data)
