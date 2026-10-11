"""The notification ledger GitHub records, and carousel delivery receipts.

Each recorded notification post joins the Supabase ingestion queue through a
database trigger; nothing on the Mac claims or settles ledger rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Sequence
from uuid import UUID

from core.constants import INSTAGRAM_BATCH_PUBLISHED
from core.database import get_sb
from core.tables import INSTAGRAM_PUBLISH_BATCHES
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


def acknowledge_carousel_delivery(
    *, row_id: str, delivery_generation: str, sources: list[dict[str, Any]]
) -> None:
    """Record delivery only after the carousel's posts have committed to the local queue.

    This receipt is independent of engagement completion.
    A recreated queue uses a new generation and discovers the carousel again.
    """
    (
        get_sb()
        .table(INSTAGRAM_PUBLISH_BATCHES)
        .update(
            {
                "browser_delivery_generation": str(UUID(delivery_generation)),
                "browser_delivery_sources": validate_browser_sources(sources),
            },
            returning="minimal",
        )
        .eq("id", str(UUID(row_id)))
        .eq("status", INSTAGRAM_BATCH_PUBLISHED)
        .execute()
    )


@dataclass(frozen=True)
class MaterializedMedia:
    """One exact Instagram media target recovered from a notification."""

    media_id: str
    source_url: str


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
