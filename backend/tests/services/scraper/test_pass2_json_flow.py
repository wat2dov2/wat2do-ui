"""Pass 2 reconcile end-to-end tests with canned JSON (no Pass 1 / no live LLM).

These fixtures prove the product rules we care about:
  * update caption + matching candidate id → overwrite
  * cancel caption → cancelled=true on existing id
  * same-occurrence repost → overwrite even without update language
  * distinct occurrence → insert (id null)
  * omitted candidates are not deleted
  * Pass 2 failure → pipeline falls back to insert-only
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest

from schemas.event import EventResponse
from services.scraper import event_writer
from services.scraper import pipeline as pipeline_module
from services.scraper.event_writer import write_event
from services.scraper.extractor import Completion
from services.scraper.reconciler import reconcile_events

_FUTURE = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
_FUTURE_ISO = _FUTURE.isoformat().replace("+00:00", "Z")
_NEXT_FUTURE_ISO = (_FUTURE + timedelta(days=7)).isoformat().replace("+00:00", "Z")


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(
        event_writer.school_service,
        "get_school",
        lambda slug: SimpleNamespace(id=1, slug=slug),
    )
    monkeypatch.setattr(
        pipeline_module,
        "_lookup_club_by_ig",
        lambda handle: None,
    )


def _extracted(**overrides) -> dict:
    base = {
        "title": "Tea Tasting Night",
        "description": "Come try teas.",
        "location": "SLC 3223",
        "club": "UW Tea Club",
        "price": 0.0,
        "food": ["Yes!"],
        "registration": False,
        "image_index": 0,
        "occurrences": [
            {
                "dtstart_utc": _FUTURE_ISO,
                "dtend_utc": None,
                "duration": None,
                "tz": "America/Toronto",
            }
        ],
        "school": "uwaterloo",
        "category": "Arts & Culture",
        "source_image_url": "https://cdn/img.jpg",
    }
    base.update(overrides)
    return base


def _candidate(**overrides) -> dict:
    base = {
        "id": 42,
        "title": "Tea Tasting Night",
        "description": "Longer original description that should be replaceable.",
        "location": "SLC 1000",
        "club": "UW Tea Club",
        "club_id": 7,
        "price": 0.0,
        "food": ["Yes!"],
        "registration": False,
        "category": "Arts & Culture",
        "ig_handle": "uwteaclub",
        "school": "uwaterloo",
        "cancelled": False,
        "source_url": "https://instagram.com/p/OLD",
        "source_image_url": "https://cdn/old.jpg",
        "occurrences": [
            {
                "dtstart_utc": _FUTURE_ISO,
                "dtend_utc": None,
                "duration": None,
                "tz": "America/Toronto",
            }
        ],
    }
    base.update(overrides)
    return base


def _completion(payload: list[dict]) -> Completion:
    """Return ``payload`` as the Pass 2 model response."""
    return lambda _system, _prompt, _image_urls: json.dumps(payload)


# ── Pass 2 JSON → reconcile_events ────────────────────────────────────


def test_pass2_update_json_keeps_candidate_id(monkeypatch):
    """Caption says moved → Pass 2 returns id=42 with new location."""
    extracted = _extracted(location="DC 1302", description="Moved!")
    candidate = _candidate()
    pass2 = [
        {
            **extracted,
            "id": 42,
            "cancelled": False,
        }
    ]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="UPDATE: Tea tasting moved to DC 1302",
        school="uwaterloo",
        complete=complete,
    )

    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] == 42
    assert result[0]["location"] == "DC 1302"
    assert result[0]["cancelled"] is False


def test_pass2_cancel_json_sets_cancelled_true(monkeypatch):
    """Cancel caption → Pass 2 returns same event with cancelled=true."""
    extracted = _extracted()
    candidate = _candidate()
    pass2 = [
        {
            **candidate,
            "id": 42,
            "cancelled": True,
            # Pass 2 may drop DB-only fields; keep the required shape.
            "image_index": 0,
        }
    ]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="CANCELLED: Tea Tasting Night is cancelled this week.",
        school="uwaterloo",
        complete=complete,
    )

    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] == 42
    assert result[0]["cancelled"] is True
    assert result[0]["title"] == "Tea Tasting Night"


def test_pass2_new_instance_json_has_null_id(monkeypatch):
    """A distinct later occurrence remains an insert."""
    extracted = _extracted(
        title="Tea Tasting Night",
        occurrences=[
            {
                "dtstart_utc": _NEXT_FUTURE_ISO,
                "dtend_utc": None,
                "duration": None,
                "tz": "America/Toronto",
            }
        ],
    )
    candidate = _candidate()
    pass2 = [{**extracted, "id": None, "cancelled": False}]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Tea tasting next Friday in SLC 3223! A new weekly session.",
        school="uwaterloo",
        complete=complete,
    )

    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] is None
    assert result[0]["cancelled"] is False


def test_pass2_same_occurrence_repost_json_keeps_candidate_id(monkeypatch):
    """A second flyer for the same occurrence overwrites its existing event."""
    extracted = _extracted(title="Tea Tasting Night", description="Reminder: bring a mug.")
    candidate = _candidate()
    pass2 = [{**extracted, "id": 42, "cancelled": False}]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Tea Tasting Night is this Friday in SLC 3223! Bring a mug.",
        school="uwaterloo",
        complete=complete,
    )

    assert result is not None
    assert result[0]["id"] == 42


def test_pass2_omitted_candidate_is_not_in_output(monkeypatch):
    """Returning only the updated event means the other candidate is untouched."""
    extracted = _extracted()
    c1 = _candidate(id=42, title="Tea Tasting Night")
    c2 = _candidate(id=99, title="Unrelated Workshop")
    pass2 = [{**extracted, "id": 42, "cancelled": False}]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[c1, c2]],
        caption_text="Update: room change for tea tasting",
        school="uwaterloo",
        complete=complete,
    )

    assert result is not None
    ids = [e.get("id") for e in result]
    assert ids == [42]
    assert 99 not in ids


def test_pass2_shorter_description_wins(monkeypatch):
    extracted = _extracted(description="Short.")
    candidate = _candidate(description="A much longer original description.")
    pass2 = [{**extracted, "id": 42, "description": "Short.", "cancelled": False}]
    complete = _completion(pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Update: new flyer",
        school="uwaterloo",
        complete=complete,
    )

    assert result[0]["description"] == "Short."


# ── Pass 2 JSON → write_event (DB upsert) ──────────────────────────────


def _install_overwrite_stubs(monkeypatch, *, old: EventResponse, updated: EventResponse):
    calls = {"n": 0}

    def _get_event(_eid: int):
        calls["n"] += 1
        return old if calls["n"] == 1 else updated

    monkeypatch.setattr(event_writer.event_service, "get_event", _get_event)
    monkeypatch.setattr(event_writer, "enqueue_event_change", lambda *a, **k: 1)
    update = MagicMock(return_value=[])
    monkeypatch.setattr(
        event_writer.event_service,
        "update_event_and_occurrences",
        update,
    )
    return update


def test_pass2_cancel_json_overwrites_db_cancelled(fake_sb, patch_sb, monkeypatch):
    """Full path: Pass 2 cancel JSON → write_event updates cancelled=true."""
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")

    extracted = _extracted()
    candidate = _candidate()
    pass2_payload = [
        {
            "id": 42,
            "title": candidate["title"],
            "description": candidate["description"],
            "location": candidate["location"],
            "club": candidate["club"],
            "price": 0.0,
            "food": ["Yes!"],
            "registration": False,
            "image_index": 0,
            "occurrences": candidate["occurrences"],
            "school": "uwaterloo",
            "category": "Arts & Culture",
            "cancelled": True,
            "source_image_url": candidate["source_image_url"],
        }
    ]
    complete = _completion(pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="This event is CANCELLED.",
        school="uwaterloo",
        complete=complete,
    )
    assert reconciled and reconciled[0]["cancelled"] is True

    old = EventResponse.model_validate(
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "club": "UW Tea Club",
            "cancelled": False,
            "added_at": datetime.now(timezone.utc),
            "occurrences": [
                {
                    "id": UUID(int=1),
                    "event_id": 42,
                    "dtstart_utc": _FUTURE,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": "America/Toronto",
                    "created_at": datetime.now(timezone.utc),
                }
            ],
        }
    )
    updated = EventResponse.model_validate({**old.model_dump(), "cancelled": True})
    update = _install_overwrite_stubs(monkeypatch, old=old, updated=updated)

    outcome = write_event(
        reconciled[0],
        ig_handle="uwteaclub",
        source_url="https://instagram.com/p/NEW",
    )
    assert outcome == "updated"
    payload = update.call_args.args[1]
    assert payload["cancelled"] is True


def test_pass2_update_json_overwrites_location(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")

    extracted = _extracted(location="DC 1302", description="Moved room.")
    candidate = _candidate()
    pass2_payload = [{**extracted, "id": 42, "cancelled": False}]
    complete = _completion(pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Update: moved to DC 1302",
        school="uwaterloo",
        complete=complete,
    )

    old = EventResponse.model_validate(
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "club": "UW Tea Club",
            "cancelled": False,
            "added_at": datetime.now(timezone.utc),
            "occurrences": [
                {
                    "id": UUID(int=1),
                    "event_id": 42,
                    "dtstart_utc": _FUTURE,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": "America/Toronto",
                    "created_at": datetime.now(timezone.utc),
                }
            ],
        }
    )
    updated = EventResponse.model_validate({**old.model_dump(), "location": "DC 1302"})
    update = _install_overwrite_stubs(monkeypatch, old=old, updated=updated)

    outcome = write_event(
        reconciled[0],
        ig_handle="uwteaclub",
        source_url="https://instagram.com/p/NEW",
    )
    assert outcome == "updated"
    payload = update.call_args.args[1]
    assert payload["location"] == "DC 1302"
    assert payload["cancelled"] is False


def test_pass2_insert_json_creates_row(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")

    extracted = _extracted()
    pass2_payload = [{**extracted, "id": None, "cancelled": False}]
    complete = _completion(pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[]],
        caption_text="Brand new tea tasting Friday!",
        school="uwaterloo",
        complete=complete,
    )
    assert reconciled[0]["id"] is None

    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses(
        [
            [],  # org_resolve loop 1 lookup miss
            [{"id": 8}],  # club insert
            [{"id": 7}],
            [
                {
                    "id": UUID(int=1),
                    "event_id": 7,
                    "dtstart_utc": _FUTURE_ISO,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": "America/Toronto",
                    "created_at": occ_now,
                }
            ],
        ]
    )

    outcome = write_event(
        reconciled[0],
        ig_handle="uwteaclub",
        source_url="https://instagram.com/p/NEW",
    )
    assert outcome == "inserted"
    insert_payloads = [c[0][0] for c in fake_sb.insert.call_args_list if isinstance(c[0][0], dict)]
    insert_payload = next(p for p in insert_payloads if "title" in p)
    assert insert_payload["title"] == "Tea Tasting Night"
    assert insert_payload["cancelled"] is False
    assert "id" not in insert_payload


# ── Pipeline: skip Pass 1, drive Pass 2 with canned JSON ───────────────


def test_pipeline_pass2_cancel_updates_existing(monkeypatch, fake_sb, patch_sb):
    """Skip Pass 1 extract; Pass 2 cancel JSON drives an update write."""
    from services.scraper.org_resolve import ResolvedClub

    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.scraper.dedup")

    extracted = [_extracted()]
    candidate = _candidate()
    pass2 = [
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "description": candidate["description"],
            "location": "SLC 1000",
            "club": "UW Tea Club",
            "price": 0.0,
            "food": ["Yes!"],
            "registration": False,
            "image_index": 0,
            "occurrences": candidate["occurrences"],
            "school": "uwaterloo",
            "category": "Arts & Culture",
            "cancelled": True,
            "source_image_url": "https://cdn/img.jpg",
        }
    ]

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kw: SimpleNamespace(events=extracted, positions=[]),
    )
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_kw: [candidate])
    monkeypatch.setattr(
        pipeline_module,
        "resolve_club_for_scrape",
        lambda **_kw: ResolvedClub(
            club_id=7,
            club_name="UW Tea Club",
            ig_handle="uwteaclub",
        ),
    )
    monkeypatch.setattr(pipeline_module, "claude_completion", _completion(pass2))

    old = EventResponse.model_validate(
        {
            "id": 42,
            "club_id": 7,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "club": "UW Tea Club",
            "ig_handle": "uwteaclub",
            "cancelled": False,
            "added_at": datetime.now(timezone.utc),
            "occurrences": [
                {
                    "id": UUID(int=1),
                    "event_id": 42,
                    "dtstart_utc": _FUTURE,
                    "dtend_utc": None,
                    "duration": None,
                    "tz": "America/Toronto",
                    "created_at": datetime.now(timezone.utc),
                }
            ],
        }
    )
    updated = EventResponse.model_validate({**old.model_dump(), "cancelled": True})
    update = _install_overwrite_stubs(monkeypatch, old=old, updated=updated)

    inserts: list[object] = []

    def _smart_execute():
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict):
                return MagicMock(data=[{**payload, "id": 42}], count=0)
            return MagicMock(data=[], count=0)
        if fake_sb.update.call_count:
            return MagicMock(data=[{"id": 42}], count=0)
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/CANCEL1/",
            "ownerUsername": "uwteaclub",
            "caption": "CANCELLED: Tea Tasting Night is off.",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "displayUrl": "https://cdn/img.jpg",
        },
        school="uwaterloo",
    )

    update.assert_called_once()
    assert update.call_args.args[1]["cancelled"] is True


def test_pipeline_pass2_failure_falls_back_to_insert(monkeypatch, fake_sb, patch_sb):
    """If Pass 2 returns None, pipeline inserts Pass 1 events with id cleared."""
    from services.scraper.org_resolve import ResolvedClub

    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.scraper.dedup")

    extracted = [_extracted()]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls, **_: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kw: SimpleNamespace(events=extracted, positions=[]),
    )
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_kw: [_candidate()])
    monkeypatch.setattr(pipeline_module, "reconcile_events", lambda **_kw: None)
    monkeypatch.setattr(
        pipeline_module,
        "resolve_club_for_scrape",
        lambda **_kw: ResolvedClub(
            club_id=7,
            club_name="UW Tea Club",
            ig_handle="uwteaclub",
        ),
    )

    inserts: list[object] = []
    occ_now = datetime.now(timezone.utc).isoformat()

    def _smart_execute():
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict) and "title" in payload:
                return MagicMock(data=[{**payload, "id": 77}], count=0)
            if isinstance(payload, list):
                return MagicMock(
                    data=[
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
                    ],
                    count=0,
                )
            return MagicMock(data=[], count=0)
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    pipeline_module.process_post(
        {
            "url": "https://www.instagram.com/p/FALLBACK1/",
            "ownerUsername": "uwteaclub",
            "caption": "Tea tasting Friday",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "displayUrl": "https://cdn/img.jpg",
        },
        school="uwaterloo",
    )

    event_inserts = [
        c[0][0]
        for c in fake_sb.insert.call_args_list
        if isinstance(c[0][0], dict) and c[0][0].get("title") == "Tea Tasting Night"
    ]
    assert len(event_inserts) == 1
    assert "id" not in event_inserts[0]
