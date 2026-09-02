"""Durable at-most-once claims for Instagram notification media."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Sequence

from core.database import get_sb


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
