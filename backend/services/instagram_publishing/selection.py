"""Choose a factual carousel review draft; publication still requires admin review."""

from __future__ import annotations

import textwrap
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

from core.controlbox import controlbox

_CONTROL = controlbox.instagram_publishing


class CarouselPick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: int
    sticker_labels: list[str] = Field(min_length=1, max_length=_CONTROL.maximum_stickers_per_event)

    @field_validator("sticker_labels")
    @classmethod
    def validate_labels(cls, labels: list[str]) -> list[str]:
        normalized = [" ".join(label.split()) for label in labels]
        if len(set(label.casefold() for label in normalized)) != len(normalized):
            raise ValueError("Every event sticker must highlight a different benefit or detail")
        for label in normalized:
            lines = textwrap.wrap(
                label,
                width=_CONTROL.sticker_line_character_limit,
                break_long_words=False,
                break_on_hyphens=False,
            )
            if (
                not lines
                or len(lines) > _CONTROL.sticker_maximum_lines
                or any(len(line) > _CONTROL.sticker_line_character_limit for line in lines)
            ):
                raise ValueError("Sticker labels must fit two lines of at most 12 characters")
            if any(
                next((char for char in word if char.isalpha()), "A").islower()
                for word in label.split()
            ):
                raise ValueError("Sticker words must start with capital letters")
        return normalized


class DraftSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")
    account_key: str = Field(min_length=1)
    window_end: datetime
    caption_intro: str = Field(max_length=2200)
    cover_body: str = Field(max_length=280)
    picks: list[CarouselPick]


def validate_picks(candidates: list[dict[str, Any]], picks: list[CarouselPick]) -> None:
    """Validate external editorial choices against this school's current candidates."""
    allowed = {event["id"] for event in candidates}
    ids = [pick.event_id for pick in picks]
    if len(set(ids)) != len(ids) or any(event_id not in allowed for event_id in ids):
        raise ValueError("Draft choices must contain distinct eligible events")
