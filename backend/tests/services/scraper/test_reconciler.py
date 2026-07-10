"""Unit tests for Pass 2 reconciler schema + unknown-id handling."""

from services.scraper.reconciler import ReconciledEvent, reconcile_events


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
    """Candidate with a different organization_id cannot be overwritten."""
    _mock_client(
        monkeypatch,
        '[{"id": 42, "title": "Tea", "location": "SLC", "cancelled": false, '
        '"occurrences": [{"dtstart_utc": "2026-07-10T22:00:00Z"}]}]',
    )

    result = reconcile_events(
        extracted_events=[{"title": "Tea"}],
        candidates_by_index=[
            [{"id": 42, "title": "Tea", "organization_id": 99, "ig_handle": "other"}]
        ],
        caption_text="UPDATE: Tea moved to SLC",
        school="uwaterloo",
        resolved_organization_ids=[7],
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
        candidates_by_index=[
            [{"id": 42, "title": "Tea", "organization_id": None, "ig_handle": "uwtea"}]
        ],
        caption_text="UPDATE: Tea moved to SLC",
        school="uwaterloo",
        resolved_organization_ids=[7],
        resolved_ig_handles=["uwtea"],
    )
    assert result is not None
    assert result[0]["id"] == 42
