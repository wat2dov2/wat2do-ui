import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

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


def mock_model(monkeypatch, picks):
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.completions.create.return_value = SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps({"picks": picks})))],
    )
    monkeypatch.setattr(selection, "OpenAI", lambda **_: client)
    monkeypatch.setattr(selection.settings, "openai_api_key", "test-key")
    return client


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


def test_model_selects_nine_distinct_events_with_saved_sticker_order(monkeypatch):
    picks = [
        {"event_id": i, "sticker_ids": ["movie-night", "campus-pick"]} for i in range(10, 1, -1)
    ]
    client = mock_model(monkeypatch, picks)
    result = selection.select_carousel([event(i) for i in range(1, 13)], NOW)
    assert [pick.event_id for pick in result] == list(range(10, 1, -1))
    request = client.chat.completions.create.call_args.kwargs
    assert request["model"] == "gpt-6-luna"
    assert request["response_format"]["json_schema"]["strict"] is True
    assert len(selection._CONTROL.sticker_catalog) == 100


@pytest.mark.parametrize(
    "picks",
    [
        [{"event_id": 999, "sticker_ids": ["campus-pick"]}],
        [{"event_id": 1, "sticker_ids": ["free-food"]}],
        [{"event_id": 1, "sticker_ids": ["invented"]}],
        [{"event_id": 1, "sticker_ids": ["campus-pick", "campus-pick"]}],
        [],
    ],
)
def test_invalid_model_choices_fail_instead_of_publishing_invented_facts(monkeypatch, picks):
    mock_model(monkeypatch, picks)
    with pytest.raises(ValueError):
        selection.select_carousel([event()], NOW)


def test_missing_credentials_fail_clearly_and_empty_pool_needs_no_model(monkeypatch):
    monkeypatch.setattr(selection.settings, "openai_api_key", "")
    assert selection.select_carousel([], NOW) == []
    with pytest.raises(RuntimeError, match="API key"):
        selection.select_carousel([event()], NOW)
