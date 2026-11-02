"""Click-count reads.

Interactions are recorded by the Rust API (``rust/src/api/events/interactions.rs``);
this module keeps the reads Python still makes.
"""

import logging

from core.database import get_sb
from core.pagination import fetch_all_pages

log = logging.getLogger(__name__)


def get_click_counts_for_positions(position_ids: list[int]) -> dict[int, int]:
    return _get_click_counts(position_ids, "position")


def _get_click_counts(item_ids: list[int], resource: str) -> dict[int, int]:
    unique_ids = sorted(set(item_ids))
    if not unique_ids:
        return {}
    try:
        rows = fetch_all_pages(
            lambda offset, page_size: (
                get_sb()
                .rpc(f"get_{resource}_click_counts", {f"p_{resource}_ids": unique_ids})
                .order(f"{resource}_id")
                .range(offset, offset + page_size - 1)
                .execute()
                .data
                or []
            )
        )
    except Exception as exc:
        log.warning("Failed to fetch %s click counts: %s", resource, exc)
        return {}
    counts: dict[int, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            counts[int(row[f"{resource}_id"])] = int(row["click_count"])
        except (KeyError, TypeError, ValueError):
            continue
    return counts
