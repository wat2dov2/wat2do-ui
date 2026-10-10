"""End-to-end pipeline integration tests for services/scraper.

These complement the per-helper unit tests by exercising ``process_post``
and the local ingestion processor with mocked Claude, storage, and DB.
The big invariant they protect: a post with N occurrences must produce
one events row plus N event_dates rows.

Mocks installed:
    * ``upload_post_images``           -> returns the URLs verbatim
      (skip the storage round-trip).
    * ``extract_post_content``         -> returns canned events with
      multiple occurrences.
    * ``find_candidates``              -> returns [] (no candidates).
    * ``reconcile_events``             -> returns Pass 1 events unchanged.
    * ``get_sb()`` on event_writer + event_date_service + dedup + club_service
      -> patched to ``fake_sb``; the test asserts on the recorded
      builder calls afterwards.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import UUID

import pytest

from services.ingestion.processor import process_queue
from services.ingestion.queue import IngestionQueue, QueueItem
from services.scraper import event_writer
from services.scraper import extractor as extractor_module
from services.scraper import pipeline as pipeline_module


def _future_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _instagram_post(handle: str = "uwteaclub") -> dict:
    """Minimal-but-realistic retrieved Instagram post."""
    return {
        "url": "https://www.instagram.com/p/ABC123/",
        "ownerUsername": handle,
        "caption": "Tea tasting series - Mondays in December",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "displayUrl": "https://cdn/uwteaclub-1.jpg",
    }


def _directory_page() -> dict:
    return {
        "url": "https://clubs.example.edu/events/tea",
        "caption": "Hosted by UW Tea Club\nTea tasting series - Mondays in December",
        "images": ["https://clubs.example.edu/tea.jpg"],
    }


def _extracted_event_with_three_occurrences() -> list[dict]:
    return [
        {
            "title": "Tea Tasting Series",
            "description": "Tea tasting series - Mondays in December",
            "location": "SLC 3223",
            "club": "UW Tea Club",
            "category": "Arts & Culture",
            "image_index": 0,
            "price": 0.0,
            "food": ["Yes!"],
            "registration": False,
            "school": "uwaterloo",
            "occurrences": [
                {
                    "dtstart_utc": _future_iso(2),
                    "dtend_utc": "",
                    "duration": "",
                    "tz": "America/Toronto",
                },
                {
                    "dtstart_utc": _future_iso(9),
                    "dtend_utc": "",
                    "duration": "",
                    "tz": "America/Toronto",
                },
                {
                    "dtstart_utc": _future_iso(16),
                    "dtend_utc": "",
                    "duration": "",
                    "tz": "America/Toronto",
                },
            ],
        }
    ]


def test_extraction_provider_failure_keeps_capture_queued(tmp_path, monkeypatch, caplog):
    queue = IngestionQueue(tmp_path)
    post = _instagram_post()
    queue.enqueue(QueueItem(school="ubc", post=post))
    monkeypatch.setattr(pipeline_module, "existing_shortcodes", lambda _: set())
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: urls)
    completion = Mock(return_value=None)
    monkeypatch.setattr(pipeline_module, "claude_completion", completion)
    write_event = Mock()
    monkeypatch.setattr(pipeline_module, "write_event", write_event)
    monkeypatch.setattr(extractor_module, "resolve_school_timezone", lambda _: "America/Toronto")
    monkeypatch.setattr(extractor_module, "current_semester_end", lambda *args, **kwargs: None)
    monkeypatch.setattr(extractor_module, "campus_season_prompt", lambda _: "")

    result = process_queue(queue)

    assert result == {"processed": 0, "failed": 1}
    assert completion.call_args.args[2] == [post["displayUrl"]]
    write_event.assert_not_called()
    # The capture waits for a later run instead of exhausting its attempts now.
    assert queue.counts() == {"queued": 1, "checked": 0}
    assert queue.claim() is None
    assert post["caption"] not in caplog.text


@pytest.mark.parametrize(
    ("post", "ingestion_source"),
    [
        pytest.param(_instagram_post(), "instagram_scraper", id="instagram"),
        pytest.param(_directory_page(), "directory", id="directory"),
    ],
)
def test_pipeline_produces_one_event_row_per_logical_event(
    monkeypatch, fake_sb, patch_sb, post, ingestion_source
):
    """Multi-occurrence post -> 1 events row + N event_dates rows.

    Multi-occurrence events should not be split into separate parent event
    rows.
    """
    # Patch the DB everywhere the pipeline reaches.
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.scraper.dedup")
    patch_sb("services.club_service")

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(
        event_writer.school_service,
        "get_school",
        lambda slug: SimpleNamespace(id=1, slug=slug),
    )
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kw: SimpleNamespace(
            events=_extracted_event_with_three_occurrences(),
            positions=[],
        ),
    )
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_kw: [])
    monkeypatch.setattr(
        pipeline_module,
        "reconcile_events",
        lambda **kw: kw["extracted_events"],
    )

    # Smart side_effect: dispatch on the latest builder method called.
    # ``insert`` returns a row that satisfies whichever Pydantic model
    # the caller constructs from r.data[0]; everything else returns [].
    occ_now = datetime.now(timezone.utc).isoformat()
    inserts: list[object] = []  # captured insert payloads, in order

    def _smart_execute():
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict):
                # events (or club stub) row insert
                return MagicMock(data=[{**payload, "id": 7}], count=0)
            # event_dates bulk insert - echo with fabricated ids/times.
            rows = [
                {
                    "id": UUID(int=i + 1),
                    "event_id": row["event_id"],
                    "dtstart_utc": row["dtstart_utc"],
                    "dtend_utc": row.get("dtend_utc"),
                    "duration": row.get("duration"),
                    "tz": row.get("tz"),
                    "created_at": occ_now,
                }
                for i, row in enumerate(payload)
            ]
            return MagicMock(data=rows, count=0)
        # Pure read (existing source identity, clubs lookup) - empty result.
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    pipeline_module.process_post(post, school="uwaterloo")

    # The headline invariant: ONE events insert (dict payload) + ONE
    # event_dates insert (list payload of 3 rows).
    dict_inserts = [c for c in fake_sb.insert.call_args_list if isinstance(c[0][0], dict)]
    list_inserts = [c for c in fake_sb.insert.call_args_list if isinstance(c[0][0], list)]
    events_inserts = [c for c in dict_inserts if c[0][0].get("title") == "Tea Tasting Series"]
    assert len(events_inserts) == 1
    assert events_inserts[0][0][0]["school_id"] == 1
    assert events_inserts[0][0][0]["food"] == ["Food"]
    assert events_inserts[0][0][0]["source_url"] == post["url"]
    assert events_inserts[0][0][0]["ingestion_source"] == ingestion_source
    assert "school" not in events_inserts[0][0][0]

    occurrence_inserts = [
        c
        for c in list_inserts
        if c[0][0] and "dtstart_utc" in c[0][0][0] and "event_id" in c[0][0][0]
    ]
    assert len(occurrence_inserts) == 1
    assert len(occurrence_inserts[0][0][0]) == 3, (
        "expected 3 event_dates rows for the 3-occurrence event"
    )
