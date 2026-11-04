"""Public position-directory reads."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from dateutil.relativedelta import relativedelta

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import POSITIONS


def _apply_open_filter(query: Any) -> Any:
    now = datetime.now(timezone.utc)
    today = now.date().isoformat()
    cutoff = (
        now - relativedelta(months=controlbox.positions.undated_visibility_months)
    ).isoformat()
    return query.eq("is_active", True).or_(
        f"deadline_date.gte.{today},and(deadline_date.is.null,added_at.gte.{cutoff})"
    )


def get_club_position_counts(
    club_ids: list[int],
) -> dict[int, int]:
    """Return per-club open-position totals."""
    if not club_ids:
        return {}

    counts = {club_id: 0 for club_id in club_ids}
    response = _apply_open_filter(
        get_sb()
        .table(POSITIONS)
        .select("club_id,cohost_club_ids")
        .or_(
            "club_id.in.("
            + ",".join(map(str, club_ids))
            + "),cohost_club_ids.ov.{"
            + ",".join(map(str, club_ids))
            + "}"
        )
    ).execute()

    for row in response.data or []:
        for club_id in {row.get("club_id"), *(row.get("cohost_club_ids") or [])}:
            if club_id in counts:
                counts[club_id] += 1

    return counts
