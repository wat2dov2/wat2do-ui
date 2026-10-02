"""Choose a bounded, factual carousel draft; publication still requires admin review."""

from __future__ import annotations

import re
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from pydantic import BaseModel, ConfigDict, Field

from core.controlbox import controlbox

_CONTROL = controlbox.instagram_publishing


class CarouselPick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int
    sticker_ids: list[str] = Field(min_length=1, max_length=_CONTROL.maximum_stickers_per_event)


class DraftSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_key: str = Field(min_length=1)
    window_end: datetime
    caption_intro: str = Field(max_length=2200)
    cover_body: str = Field(max_length=280)
    picks: list[CarouselPick] = Field(max_length=_CONTROL.maximum_event_slides)


def eligible_sticker_ids(event: dict[str, Any], now: datetime) -> list[str]:
    """Factual labels are checked when saving a draft and again at publish time."""
    source = " ".join(
        str(event.get(key) or "") for key in ("title", "description", "category", "food")
    ).lower()
    zone = ZoneInfo(event["tz"])
    today = now.astimezone(zone).date()
    start = datetime.fromisoformat(str(event["dtstart_utc"]).replace("Z", "+00:00"))
    day = start.astimezone(zone).date()
    facts = {
        "any": True,
        "free": event.get("price") == 0,
        "free_food": bool(
            re.search(
                r"\bfree\s+(?:food|pizza|snacks|lunch|dinner|breakfast|refreshments)\b|repas gratuit",
                source,
            )
        ),
        "food": bool(event.get("food")),
        "today": day == today,
        "tomorrow": day == today + timedelta(days=1),
        "weekend": day.weekday() >= 5 and 0 <= (day - today).days <= 6 - today.weekday(),
    }
    return [
        sticker.id
        for sticker in _CONTROL.sticker_catalog
        if (
            any(re.search(r"\b" + re.escape(word) + r"\b", source) for word in sticker.keywords)
            if sticker.rule == "topic"
            else facts.get(sticker.rule, False)
        )
    ]


def validate_picks(
    candidates: list[dict[str, Any]], picks: list[CarouselPick], now: datetime
) -> None:
    """Validate external editorial choices against this school's current candidates."""
    allowed = {event["id"]: eligible_sticker_ids(event, now) for event in candidates}
    ids = [pick.event_id for pick in picks]
    if (
        len(ids) > _CONTROL.maximum_event_slides
        or len(set(ids)) != len(ids)
        or any(event_id not in allowed for event_id in ids)
        or bool(candidates) != bool(picks)
    ):
        raise ValueError("Draft choices must contain distinct eligible events")
    for pick in picks:
        if len(set(pick.sticker_ids)) != len(pick.sticker_ids) or not set(pick.sticker_ids) <= set(
            allowed[pick.event_id]
        ):
            raise ValueError("Draft choices contain unsupported stickers")
