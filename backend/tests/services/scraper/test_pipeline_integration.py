"""End-to-end pipeline integration tests for services/scraper.

These complement the per-helper unit tests by exercising the full
``run_pipeline`` orchestrator with mocked Apify, OpenAI, storage, and DB.
    The big invariant they protect: a post with N occurrences must produce
    one events row plus N event_dates rows.

Mocks installed:
    * ``upload_post_images``           -> returns the URLs verbatim
      (skip the storage round-trip).
    * ``extract_post_content``         -> returns canned events with
      multiple occurrences.
    * ``find_candidates``              -> returns [] (no candidates).
    * ``reconcile_events``             -> returns Pass 1 events unchanged.
    * ``get_sb()`` on event_writer + event_date_service + workflow_run_service
      -> patched to ``fake_sb``; the test asserts on the recorded
      builder calls afterwards.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock
from uuid import UUID

from services.scraper import event_writer
from services.scraper import extractor as extractor_module
from services.scraper import pipeline as pipeline_module


def _future_iso(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


def _apify_post(handle: str = "uwteaclub") -> dict:
    """Minimal-but-realistic Apify Instagram-post-scraper item."""
    return {
        "url": "https://www.instagram.com/p/ABC123/",
        "ownerUsername": handle,
        "caption": "Tea tasting series - Mondays in December",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "displayUrl": "https://cdn/uwteaclub-1.jpg",
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


def test_notification_provider_failure_preserves_pending_media(tmp_path, monkeypatch, caplog):
    from services.instagram_notifications import notification_ingestion as bridge
    from services.instagram_notifications.browser_queue import BrowserJobQueue

    post = _apify_post()
    row = {"id": "d6246624-50f7-4aa1-bf0a-0d14b604d5a7", "source_url": post["url"]}
    queue = BrowserJobQueue(tmp_path)
    recipient, account = "12342599092", "ubc.wat2do.io"
    job_id = queue.enqueue_retrieval(
        school="ubc", recipient_id=recipient, account_username=account, url=post["url"]
    )
    queue.finish(queue.claim_next(), result={"target_url": post["url"], "posts": [post]})
    monkeypatch.setattr(bridge, "_pending_rows", lambda: [row])
    monkeypatch.setattr(bridge, "_identity", lambda _: ("ubc", recipient, account))
    ledger = {"status": "pending"}

    def claim(**_):
        ledger["status"] = "running"
        return True

    def rollback(**_):
        ledger["status"] = "pending"
        return True

    monkeypatch.setattr(bridge, "claim_pending_browser_media", claim)
    monkeypatch.setattr(bridge, "rollback_media_claim", rollback)
    finalize_media = Mock(return_value=True)
    monkeypatch.setattr(bridge, "mark_media_succeeded", finalize_media)
    monkeypatch.setattr(pipeline_module, "existing_shortcodes", lambda _: set())
    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: urls)
    monkeypatch.setattr(
        pipeline_module.workflow_run_service,
        "create_workflow_run",
        lambda _: SimpleNamespace(id="offline-run"),
    )
    finalize_pipeline = Mock()
    monkeypatch.setattr(pipeline_module.workflow_run_service, "mark_finished", finalize_pipeline)
    create = Mock(side_effect=TimeoutError("upstream-private-detail"))
    monkeypatch.setattr(
        extractor_module,
        "_client",
        lambda: SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create))),
    )
    monkeypatch.setattr(extractor_module, "resolve_school_timezone", lambda _: "America/Toronto")
    monkeypatch.setattr(extractor_module, "current_semester_end", lambda *args, **kwargs: None)
    monkeypatch.setattr(extractor_module, "campus_season_prompt", lambda _: "")

    result = bridge.import_retrieved_media(queue)

    assert result["failed"] == 1 and result["imported"] == 0
    assert ledger["status"] == "pending"
    assert queue.get(job_id).state == "pending"
    assert queue.get_setting(f"notification_import_attempts:{row['id']}") == 1
    assert queue.get_setting(bridge._JOURNAL) is None
    finalize_media.assert_not_called()
    assert finalize_pipeline.call_args.kwargs["status"] == "error"
    assert finalize_pipeline.call_args.kwargs["events_saved"] == 0
    assert finalize_pipeline.call_args.kwargs["error_message"] == "Instagram post extraction failed"
    assert "upstream-private-detail" not in caplog.text


def test_pipeline_produces_one_event_row_per_logical_event(monkeypatch, fake_sb, patch_sb):
    """Multi-occurrence post -> 1 events row + N event_dates rows.

    Multi-occurrence events should not be split into separate parent event
    rows.
    """
    # Patch the DB everywhere the pipeline reaches.
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.workflow_run_service")
    patch_sb("services.scraper.dedup")

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
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
        # Walk back through the recent fake_sb calls to figure out what
        # the active query is doing. The most recent insert/update/etc.
        # call records its arg in fake_sb.<method>.call_args_list - we
        # check those rather than trying to thread state through queue.
        if fake_sb.insert.call_count > len(inserts):
            payload = fake_sb.insert.call_args_list[-1][0][0]
            inserts.append(payload)
            if isinstance(payload, dict):
                if "ig_username" in payload:  # workflow_runs row
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
                # events row insert
                return MagicMock(data=[{**payload, "id": 7}], count=0)
            elif isinstance(payload, list):
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
        if fake_sb.update.call_count > 0:
            # mark_finished returns one updated row; we don't need a
            # specific shape for the assertions.
            return MagicMock(
                data=[
                    {
                        "id": "00000000-0000-0000-0000-000000000aaa",
                        "ig_username": "uwteaclub",
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
        # Pure read (existing_shortcodes, clubs lookup) - empty result.
        return MagicMock(data=[], count=0)

    fake_sb.execute.side_effect = _smart_execute

    result = pipeline_module.run_pipeline(
        ig_handle="uwteaclub",
        school="uwaterloo",
        posts=[_apify_post()],
        cutoff_days=4,
        dry_run=False,
    )

    assert result.events_extracted == 1
    assert result.events_saved == 1
    assert result.events_updated == 0
    assert result.events_duplicates == 0

    # The headline invariant: ONE events insert (dict payload) + ONE
    # event_dates insert (list payload of 3 rows).
    dict_inserts = [c for c in fake_sb.insert.call_args_list if isinstance(c[0][0], dict)]
    list_inserts = [c for c in fake_sb.insert.call_args_list if isinstance(c[0][0], list)]
    # `dict_inserts` includes both the events row insert AND the
    # workflow_run_service.create insert; we only care that there's
    # exactly ONE events-shaped dict insert.
    events_inserts = [c for c in dict_inserts if c[0][0].get("title") == "Tea Tasting Series"]
    assert len(events_inserts) == 1
    assert events_inserts[0][0][0]["school_id"] == 1
    assert events_inserts[0][0][0]["food"] == ["Food"]
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


def test_pipeline_dry_run_skips_db_writes(monkeypatch, fake_sb, patch_sb):
    """Dry-run path: NO workflow_runs row, NO events row, NO event_dates row.

    Dry-run also skips the seen-shortcodes fetch so the operator can
    re-process posts already in the DB without deleting anything first.
    """
    patch_sb("services.scraper.event_writer")
    patch_sb("services.event_date_service")
    patch_sb("services.workflow_run_service")
    patch_sb("services.scraper.dedup")

    monkeypatch.setattr(pipeline_module, "upload_post_images", lambda urls: list(urls))
    monkeypatch.setattr(
        pipeline_module,
        "extract_post_content",
        lambda **_kw: SimpleNamespace(
            events=_extracted_event_with_three_occurrences(),
            positions=[],
        ),
    )

    result = pipeline_module.run_pipeline(
        ig_handle="uwteaclub",
        school="uwaterloo",
        posts=[_apify_post()],
        cutoff_days=4,
        dry_run=True,
    )

    assert result.events_extracted == 1
    assert result.events_saved == 1
    assert result.workflow_run_id is None

    # No insert/update calls of any kind on the fake_sb.
    assert fake_sb.insert.call_count == 0
    assert fake_sb.update.call_count == 0
