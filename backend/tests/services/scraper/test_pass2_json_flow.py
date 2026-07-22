"""Pass 2 reconcile end-to-end tests with canned JSON (no Pass 1 / no live LLM).

These fixtures prove the product rules we care about:
  * update caption + matching candidate id → overwrite
  * cancel caption → cancelled=true on existing id
  * no update language → insert (id null) even if candidates exist
  * omitted candidates are not deleted
  * Pass 2 failure → pipeline falls back to insert-only
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock
from uuid import UUID

from schemas.event import EventResponse
from services.scraper import event_writer
from services.scraper import pipeline as pipeline_module
from services.scraper.event_writer import write_event
from services.scraper.reconciler import reconcile_events

_FUTURE = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
_FUTURE_ISO = _FUTURE.isoformat().replace("+00:00", "Z")


def _extracted(**overrides) -> dict:
    base = {
        "title": "Tea Tasting Night",
        "description": "Come try teas.",
        "location": "SLC 3223",
        "organization": "UW Tea Organization",
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
        "organization": "UW Tea Organization",
        "organization_id": 7,
        "price": 0.0,
        "food": ["Yes!"],
        "registration": False,
        "category": "Arts & Culture",
        "ig_handle": "uwteaorganization",
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


def _mock_openai_json(monkeypatch, payload: list[dict] | dict | str | None):
    """Install a fake OpenAI client that returns ``payload`` as message content."""
    if payload is None:
        content = "null"
    elif isinstance(payload, str):
        content = payload
    else:
        content = json.dumps(payload)

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
    _mock_openai_json(monkeypatch, pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="UPDATE: Tea tasting moved to DC 1302",
        school="uwaterloo",
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
    _mock_openai_json(monkeypatch, pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="CANCELLED: Tea Tasting Night is cancelled this week.",
        school="uwaterloo",
    )

    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] == 42
    assert result[0]["cancelled"] is True
    assert result[0]["title"] == "Tea Tasting Night"


def test_pass2_new_instance_json_has_null_id(monkeypatch):
    """No update language → insert even when a similar candidate exists."""
    extracted = _extracted(title="Tea Tasting Night")
    candidate = _candidate()
    pass2 = [{**extracted, "id": None, "cancelled": False}]
    _mock_openai_json(monkeypatch, pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Tea tasting this Friday in SLC 3223!",
        school="uwaterloo",
    )

    assert result is not None
    assert len(result) == 1
    assert result[0]["id"] is None
    assert result[0]["cancelled"] is False


def test_pass2_omitted_candidate_is_not_in_output(monkeypatch):
    """Returning only the updated event means the other candidate is untouched."""
    extracted = _extracted()
    c1 = _candidate(id=42, title="Tea Tasting Night")
    c2 = _candidate(id=99, title="Unrelated Workshop")
    pass2 = [{**extracted, "id": 42, "cancelled": False}]
    _mock_openai_json(monkeypatch, pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[c1, c2]],
        caption_text="Update: room change for tea tasting",
        school="uwaterloo",
    )

    assert result is not None
    ids = [e.get("id") for e in result]
    assert ids == [42]
    assert 99 not in ids


def test_pass2_shorter_description_wins(monkeypatch):
    extracted = _extracted(description="Short.")
    candidate = _candidate(description="A much longer original description.")
    pass2 = [{**extracted, "id": 42, "description": "Short.", "cancelled": False}]
    _mock_openai_json(monkeypatch, pass2)

    result = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Update: new flyer",
        school="uwaterloo",
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
            "organization": candidate["organization"],
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
    _mock_openai_json(monkeypatch, pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="This event is CANCELLED.",
        school="uwaterloo",
    )
    assert reconciled and reconciled[0]["cancelled"] is True

    old = EventResponse.model_validate(
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "organization": "UW Tea Organization",
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
        ig_handle="uwteaorganization",
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
    _mock_openai_json(monkeypatch, pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[candidate]],
        caption_text="Update: moved to DC 1302",
        school="uwaterloo",
    )

    old = EventResponse.model_validate(
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "organization": "UW Tea Organization",
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
        ig_handle="uwteaorganization",
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
    _mock_openai_json(monkeypatch, pass2_payload)

    reconciled = reconcile_events(
        extracted_events=[extracted],
        candidates_by_index=[[]],
        caption_text="Brand new tea tasting Friday!",
        school="uwaterloo",
    )
    assert reconciled[0]["id"] is None

    occ_now = datetime.now(timezone.utc).isoformat()
    fake_sb.queue_responses(
        [
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
        ig_handle="uwteaorganization",
        source_url="https://instagram.com/p/NEW",
    )
    assert outcome == "inserted"
    insert_payload = [c[0][0] for c in fake_sb.insert.call_args_list if isinstance(c[0][0], dict)][
        0
    ]
    assert insert_payload["title"] == "Tea Tasting Night"
    assert insert_payload["cancelled"] is False
    assert "id" not in insert_payload


# ── Pipeline: skip Pass 1, drive Pass 2 with canned JSON ───────────────


def test_pipeline_pass2_cancel_updates_existing(monkeypatch, fake_sb, patch_sb):
    """Skip Pass 1 extract; Pass 2 cancel JSON drives an update write."""
    from services.scraper.org_resolve import ResolvedOrganization

    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.workflow_run_service")
    patch_sb("services.scraper.dedup")

    extracted = [_extracted()]
    candidate = _candidate()
    pass2 = [
        {
            "id": 42,
            "title": "Tea Tasting Night",
            "description": candidate["description"],
            "location": "SLC 1000",
            "organization": "UW Tea Organization",
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

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(pipeline_module, "extract_events_from_post", lambda **_kw: extracted)
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_kw: [candidate])
    monkeypatch.setattr(
        pipeline_module,
        "resolve_organization_for_scrape",
        lambda **_kw: ResolvedOrganization(
            organization_id=7,
            organization_name="UW Tea Organization",
            association_affiliated=False,
            ig_handle="uwteaorganization",
        ),
    )
    _mock_openai_json(monkeypatch, pass2)

    old = EventResponse.model_validate(
        {
            "id": 42,
            "organization_id": 7,
            "title": "Tea Tasting Night",
            "location": "SLC 1000",
            "organization": "UW Tea Organization",
            "ig_handle": "uwteaorganization",
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

    occ_now = datetime.now(timezone.utc).isoformat()
    inserts: list[object] = []

    def _smart_execute():
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict) and "ig_username" in payload:
                return MagicMock(
                    data=[
                        {
                            "id": "00000000-0000-0000-0000-000000000aaa",
                            "ig_username": payload["ig_username"],
                            "github_run_id": payload.get("github_run_id"),
                            "status": "running",
                            "posts_fetched": 0,
                            "posts_new": 0,
                            "events_extracted": 0,
                            "events_saved": 0,
                            "pinned_post_warning": False,
                            "error_message": None,
                            "started_at": occ_now,
                            "finished_at": None,
                        }
                    ],
                    count=0,
                )
            if isinstance(payload, dict):
                return MagicMock(data=[{**payload, "id": 42}], count=0)
            return MagicMock(data=[], count=0)
        if fake_sb.update.call_count:
            # First updates are event overwrites; later may be workflow finish.
            last = fake_sb.update.call_args_list[-1][0][0]
            if isinstance(last, dict) and "cancelled" in last:
                return MagicMock(data=[{"id": 42}], count=0)
            return MagicMock(
                data=[
                    {
                        "id": "00000000-0000-0000-0000-000000000aaa",
                        "ig_username": "uwteaorganization",
                        "github_run_id": None,
                        "status": "success",
                        "posts_fetched": 1,
                        "posts_new": 1,
                        "events_extracted": 1,
                        "events_saved": 1,
                        "pinned_post_warning": False,
                        "error_message": None,
                        "started_at": occ_now,
                        "finished_at": occ_now,
                    }
                ],
                count=0,
            )
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    result = pipeline_module.run_pipeline(
        ig_handle="uwteaorganization",
        school="uwaterloo",
        posts=[
            {
                "url": "https://www.instagram.com/p/CANCEL1/",
                "ownerUsername": "uwteaorganization",
                "caption": "CANCELLED: Tea Tasting Night is off.",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "displayUrl": "https://cdn/img.jpg",
            }
        ],
        cutoff_days=4,
        dry_run=False,
    )

    assert result.events_extracted == 1
    assert result.events_updated == 1
    assert result.events_saved == 1
    update.assert_called_once()
    assert update.call_args.args[1]["cancelled"] is True


def test_pipeline_pass2_failure_falls_back_to_insert(monkeypatch, fake_sb, patch_sb):
    """If Pass 2 returns None, pipeline inserts Pass 1 events with id cleared."""
    from services.scraper.org_resolve import ResolvedOrganization

    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.workflow_run_service")
    patch_sb("services.scraper.dedup")

    extracted = [_extracted()]
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(pipeline_module, "extract_events_from_post", lambda **_kw: extracted)
    monkeypatch.setattr(pipeline_module, "find_candidates", lambda **_kw: [_candidate()])
    monkeypatch.setattr(pipeline_module, "reconcile_events", lambda **_kw: None)
    monkeypatch.setattr(
        pipeline_module,
        "resolve_organization_for_scrape",
        lambda **_kw: ResolvedOrganization(
            organization_id=7,
            organization_name="UW Tea Organization",
            association_affiliated=False,
            ig_handle="uwteaorganization",
        ),
    )

    inserts: list[object] = []
    occ_now = datetime.now(timezone.utc).isoformat()

    def _smart_execute():
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict) and "ig_username" in payload:
                return MagicMock(
                    data=[
                        {
                            "id": "00000000-0000-0000-0000-000000000bbb",
                            "ig_username": payload["ig_username"],
                            "github_run_id": payload.get("github_run_id"),
                            "status": "running",
                            "posts_fetched": 0,
                            "posts_new": 0,
                            "events_extracted": 0,
                            "events_saved": 0,
                            "pinned_post_warning": False,
                            "error_message": None,
                            "started_at": occ_now,
                            "finished_at": None,
                        }
                    ],
                    count=0,
                )
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
        if fake_sb.update.call_count > 0:
            return MagicMock(
                data=[
                    {
                        "id": "00000000-0000-0000-0000-000000000bbb",
                        "ig_username": "uwteaorganization",
                        "github_run_id": None,
                        "status": "success",
                        "posts_fetched": 1,
                        "posts_new": 1,
                        "events_extracted": 1,
                        "events_saved": 1,
                        "pinned_post_warning": False,
                        "error_message": None,
                        "started_at": occ_now,
                        "finished_at": occ_now,
                    }
                ],
                count=0,
            )
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    result = pipeline_module.run_pipeline(
        ig_handle="uwteaorganization",
        school="uwaterloo",
        posts=[
            {
                "url": "https://www.instagram.com/p/FALLBACK1/",
                "ownerUsername": "uwteaorganization",
                "caption": "Tea tasting Friday",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "displayUrl": "https://cdn/img.jpg",
            }
        ],
        cutoff_days=4,
        dry_run=False,
    )

    assert result.events_extracted == 1
    assert result.events_saved == 1
    assert result.events_updated == 0
    event_inserts = [
        c[0][0]
        for c in fake_sb.insert.call_args_list
        if isinstance(c[0][0], dict) and c[0][0].get("title") == "Tea Tasting Night"
    ]
    assert len(event_inserts) == 1
    assert "id" not in event_inserts[0]
