"""Unit tests for Pass 2 reconciler schema, prompt, and id handling."""

from services.scraper.reconciler import (
    ReconciledEvent,
    _build_reconcile_prompt,
    reconcile_events,
)


def test_reconciled_event_accepts_cancelled_with_id():
    event = ReconciledEvent.model_validate(
        {
            "id": 42,
            "title": "Tea Tasting",
            "location": "SLC",
            "cancelled": True,
            "occurrences": [
                {
                    "dtstart_utc": "2026-07-10T22:00:00+00:00",
                    "dtend_utc": None,
                    "duration": None,
                    "tz": "America/Toronto",
                }
            ],
        }
    )
    assert event.id == 42
    assert event.cancelled is True


def test_reconcile_events_empty_input_returns_empty(monkeypatch):
    assert (
        reconcile_events(
            extracted_events=[],
            candidates_by_index=[],
            caption_text="",
            school="uwaterloo",
        )
        == []
    )


def test_reconcile_prompt_reuses_same_occurrence_reposts_but_not_new_occurrences():
    prompt = _build_reconcile_prompt(
        extracted_events=[{"title": "Tea Tasting", "occurrences": []}],
        candidates_by_index=[[{"id": 42, "title": "Tea Tasting"}]],
        caption_text="A reminder for Tea Tasting.",
        school="uwaterloo",
    )

    assert "normal repost, reminder, secondary flyer" in prompt
    assert "candidate `occurrences[].dtstart_utc`" in prompt
    assert "distinct occurrence, session, edition, or new week" in prompt
    assert "matching titles alone as insufficient" in prompt
    assert "replace_occurrences" in prompt


def _matching_event_data() -> tuple[dict, dict]:
    extracted = {
        "title": "Tea Tasting",
        "description": "New details",
        "location": "SLC 3223",
        "occurrences": [{"dtstart_utc": "2026-09-10T22:00:00Z"}],
    }
    candidate = {
        "id": 42,
        "club_id": 7,
        "ig_handle": "uwtea",
        "title": "Tea Tasting",
        "location": "SLC 3223",
        "occurrences": [{"dtstart_utc": "2026-09-10T22:00:00Z"}],
    }
    return extracted, candidate


def test_reconcile_events_enforces_confident_duplicate_id(monkeypatch):
    extracted, candidate = _matching_event_data()
    _mock_client(
        monkeypatch,
        '[{"id": null, "title": "Tea Tasting", "description": "New details", '
        '"location": "SLC 3223", "cancelled": false, '
        '"occurrences": [{"dtstart_utc": "2026-09-10T22:00:00Z"}]}]',
    )

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Tea Tasting reminder",
        school="uwaterloo",
        resolved_club_ids=[7],
        resolved_ig_handles=["uwtea"],
    )

    assert result is not None
    assert result[0]["id"] == 42


def test_reconcile_events_keeps_confident_match_when_llm_unavailable(monkeypatch):
    extracted, candidate = _matching_event_data()
    monkeypatch.setattr("services.scraper.reconciler._client", lambda: None)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Tea Tasting reminder",
        school="uwaterloo",
        resolved_club_ids=[7],
        resolved_ig_handles=["uwtea"],
    )

    assert result is not None
    assert result[0]["id"] == 42
    assert result[0]["replace_occurrences"] is False


def test_reconcile_events_strips_unknown_ids(monkeypatch):
    """ids not present in candidates become inserts (id=None)."""
    monkeypatch.setattr(
        "services.scraper.reconciler._client",
        lambda: object(),
    )

    class _Msg:
        content = (
            '[{"id": 999, "title": "Tea", "location": "SLC", "cancelled": false, '
            '"occurrences": [{"dtstart_utc": "2026-07-10T22:00:00Z"}]}]'
        )

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        def create(self, **kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr("services.scraper.reconciler._client", lambda: _Client())

    result = reconcile_events(
        extracted_events=[{"title": "Tea"}],
        candidates_by_index=[[{"id": 42, "title": "Tea"}]],
        caption_text="update: moved to SLC",
        school="uwaterloo",
    )
    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] is None
    assert result[0]["title"] == "Tea"


def _mock_client(monkeypatch, content: str):
    class _Msg:
        def __init__(self):
            self.content = content

    class _Choice:
        message = _Msg()

    class _Resp:
        choices = [_Choice()]

    class _Completions:
        def create(self, **kwargs):
            return _Resp()

    class _Chat:
        completions = _Completions()

    class _Client:
        chat = _Chat()

    monkeypatch.setattr("services.scraper.reconciler._client", lambda: _Client())


def test_reconcile_events_strips_cross_org_ids(monkeypatch):
    """Candidate with a different club_id cannot be overwritten."""
    _mock_client(
        monkeypatch,
        '[{"id": 42, "title": "Tea", "location": "SLC", "cancelled": false, '
        '"occurrences": [{"dtstart_utc": "2026-07-10T22:00:00Z"}]}]',
    )

    result = reconcile_events(
        extracted_events=[{"title": "Tea"}],
        candidates_by_index=[[{"id": 42, "title": "Tea", "club_id": 99, "ig_handle": "other"}]],
        caption_text="UPDATE: Tea moved to SLC",
        school="uwaterloo",
        resolved_club_ids=[7],
        resolved_ig_handles=["uwtea"],
    )
    assert result is not None
    assert result[0]["id"] is None


def test_reconcile_events_allows_legacy_null_org_with_matching_ig(monkeypatch):
    """Scrape org_id + candidate null org_id but matching ig_handle may overwrite."""
    _mock_client(
        monkeypatch,
        '[{"id": 42, "title": "Tea", "location": "SLC", "cancelled": false, '
        '"occurrences": [{"dtstart_utc": "2026-07-10T22:00:00Z"}]}]',
    )

    result = reconcile_events(
        extracted_events=[{"title": "Tea"}],
        candidates_by_index=[[{"id": 42, "title": "Tea", "club_id": None, "ig_handle": "uwtea"}]],
        caption_text="UPDATE: Tea moved to SLC",
        school="uwaterloo",
        resolved_club_ids=[7],
        resolved_ig_handles=["uwtea"],
    )
    assert result is not None
    assert result[0]["id"] == 42
