from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from recommender import content_based
from schemas.event import EventResponse
from tests.conftest import make_db_user


@pytest.mark.parametrize(
    "hours,expected",
    [
        (-1, 0.0),
        (0, 3.0),
        (5.999, 3.0),
        (6, 2.0),
        (23.999, 2.0),
        (24, 1.0),
        (47.999, 1.0),
        (48, 0.25),
        (1000, 0.25),
    ],
)
@pytest.mark.parametrize("naive", [False, True])
def test_temporal_scoring_preserves_tier_boundaries(monkeypatch, hours, expected, naive):
    now = datetime(2026, 9, 1, tzinfo=timezone.utc)
    clock = MagicMock()
    clock.now.return_value = now
    monkeypatch.setattr(content_based, "datetime", clock)
    monkeypatch.setattr(content_based, "CB_CATEGORY_NO_PROFILE", 0.0)
    monkeypatch.setattr(content_based, "CB_TEMPORAL_TIERS", ((6, 3.0), (24, 2.0), (48, 1.0)))
    monkeypatch.setattr(content_based, "CB_TEMPORAL_FALLBACK", 0.25)
    monkeypatch.setattr(content_based, "normalize_scores", lambda scores: scores)
    starts = now + timedelta(hours=hours)
    event = EventResponse.model_validate(
        {
            "id": 1,
            "title": "Campus event",
            "location": "SLC",
            "price": 10,
            "added_at": now,
            "occurrences": [
                {
                    "id": UUID(int=1),
                    "event_id": 1,
                    "dtstart_utc": starts.replace(tzinfo=None) if naive else starts,
                    "created_at": now,
                }
            ],
        }
    )

    assert content_based.get_content_scores([event], user=make_db_user()) == {1: expected}


@pytest.mark.parametrize("price", [None, 0, 10])
@pytest.mark.parametrize("food", [None, [], ["Pizza"]])
def test_content_scoring_retains_free_event_and_food_bonuses(monkeypatch, price, food):
    monkeypatch.setattr(content_based, "CB_CATEGORY_NO_PROFILE", 0.0)
    monkeypatch.setattr(content_based, "normalize_scores", lambda scores: scores)
    event = EventResponse.model_validate(
        {
            "id": 1,
            "title": "Campus event",
            "location": "SLC",
            "price": price,
            "food": food,
            "added_at": datetime(2026, 9, 1, tzinfo=timezone.utc),
        }
    )
    expected = (content_based.CB_FREE_EVENT if price in (None, 0) else 0.0) + (
        content_based.CB_HAS_FOOD if food else 0.0
    )

    assert content_based.get_content_scores([event], user=make_db_user()) == {1: expected}


def test_missing_profile_returns_empty_without_database_lookup(monkeypatch):
    database = MagicMock(side_effect=AssertionError("No profile should not query the database"))
    monkeypatch.setattr(content_based, "get_sb", database)

    assert content_based.get_content_scores([], user=None) == {}
    database.assert_not_called()
