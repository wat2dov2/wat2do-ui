from datetime import datetime, timezone

import pytest

from services.instagram_publishing import selection

NOW = datetime(2026, 9, 29, 15, tzinfo=timezone.utc)


def event(event_id=1, **changes):
    return {
        "id": event_id,
        "title": "Film night",
        "description": "A film and conversation",
        "category": "Arts & Culture",
        "tz": "America/Toronto",
        "dtstart_utc": "2026-09-29T22:00:00Z",
        "price": 5,
        "food": [],
        **changes,
    }


def test_fact_labels_require_evidence_and_expire():
    allowed = selection.eligible_sticker_ids(event(), NOW)
    assert "happening-today" in allowed and "movie-night" in allowed
    assert "free-entry" not in allowed and "free-food" not in allowed
    assert "tea-time" not in selection.eligible_sticker_ids(event(title="Team meeting"), NOW)
    free = selection.eligible_sticker_ids(
        event(price=0, description="Free pizza", food=["pizza"]), NOW
    )
    assert {"free-entry", "free-food", "food-available", "pizza-plans"} <= set(free)
    later = selection.eligible_sticker_ids(event(), datetime(2026, 9, 30, 15, tzinfo=timezone.utc))
    assert "happening-today" not in later


def test_external_choices_preserve_editorial_order_without_model_calls():
    picks = [
        selection.CarouselPick(event_id=i, sticker_ids=["movie-night", "campus-pick"])
        for i in [3, 1]
    ]
    selection.validate_picks([event(i) for i in range(1, 5)], picks, NOW)
    assert [pick.event_id for pick in picks] == [3, 1]


@pytest.mark.parametrize(
    "picks",
    [
        [{"event_id": 999, "sticker_ids": ["campus-pick"]}],
        [{"event_id": 1, "sticker_ids": ["free-food"]}],
        [{"event_id": 1, "sticker_ids": ["invented"]}],
        [{"event_id": 1, "sticker_ids": ["campus-pick", "campus-pick"]}],
        [{"event_id": 1, "sticker_ids": ["campus-pick"]}] * 2,
        [],
    ],
)
def test_invalid_external_choices_fail_before_saving(picks):
    with pytest.raises(ValueError):
        selection.validate_picks([event()], [selection.CarouselPick(**pick) for pick in picks], NOW)


def test_empty_pool_accepts_only_empty_choices():
    selection.validate_picks([], [], NOW)
    with pytest.raises(ValueError):
        selection.validate_picks(
            [], [selection.CarouselPick(event_id=1, sticker_ids=["campus-pick"])], NOW
        )
