from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest

from schemas.event import EventSummaryResponse
from schemas.event_date import OccurrenceResponse
from schemas.instagram_publishing import (
    InstagramPublishBatchPublish,
    InstagramPublishBatchUpdate,
)
from services.instagram_publishing import service


@pytest.fixture(autouse=True)
def registered_school(monkeypatch):
    monkeypatch.setattr(service.school_service, "get_school_id", lambda _school: 1)
    monkeypatch.setattr(
        service.school_service,
        "get_school",
        lambda _school: SimpleNamespace(timezone="America/Toronto"),
    )


def test_generate_due_batches_uses_enabled_connected_accounts(monkeypatch):
    generated_accounts = []
    enabled_accounts = ["dalhousie", "uwaterloo"]
    monkeypatch.setattr(service, "_enabled_account_keys", lambda: enabled_accounts)
    monkeypatch.setattr(service, "_batch_exists", lambda *_: False)
    monkeypatch.setattr(
        service,
        "_generate_account_batch",
        lambda account, *_: generated_accounts.append(account) or "generated",
    )

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 13, tzinfo=timezone.utc),
    )

    assert result == {
        "accounts": len(enabled_accounts),
        "generated": len(enabled_accounts),
        "empty": 0,
        "skipped": 0,
        "failed": 0,
    }
    assert generated_accounts == enabled_accounts
    assert "dalhousie" in generated_accounts


def test_generate_due_batches_runs_when_the_scheduler_starts_late(monkeypatch):
    generate = Mock(return_value="generated")
    monkeypatch.setattr(service, "_generate_account_batch", generate)
    monkeypatch.setattr(service, "_batch_exists", lambda *_: False)
    enabled_account_count = 2
    monkeypatch.setattr(service, "_enabled_account_keys", lambda: ["dalhousie", "uwaterloo"])

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 14, 48, tzinfo=timezone.utc),
    )

    assert result["accounts"] == enabled_account_count
    assert generate.call_count == enabled_account_count


class _FakeQuery:
    """Supabase query builder stub: every call chains, `execute` ends it."""

    def __init__(self, data: list[dict], calls: list[tuple], *, count: int | None = None):
        self._data = data
        self._calls = calls
        self._count = len(data) if count is None else count
        self._range = None

    def range(self, start, end):
        self._calls.append(("range", (start, end), {}))
        self._range = (start, end)
        return self

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self

        return chain

    @property
    def not_(self):
        return self

    def execute(self):
        data = self._data
        if self._range is not None:
            start, end = self._range
            data = data[start : end + 1]
        return SimpleNamespace(data=data, count=self._count)


def test_list_batches_attaches_item_counts_without_hydrating_details(monkeypatch):
    batch_calls: list[tuple] = []
    item_calls: list[tuple] = []
    batches = [
        {"id": "batch-1", "school_record": {"slug": "uwaterloo"}},
        {"id": "batch-2", "school_record": {"slug": "wlu"}},
    ]
    items = [
        {"batch_id": "batch-1", "event_id": 1},
        {"batch_id": "batch-1", "event_id": 2},
        {"batch_id": "batch-2", "event_id": 3},
    ]

    def table(name: str):
        if name == service.INSTAGRAM_PUBLISH_BATCHES:
            return _FakeQuery(batches, batch_calls, count=12)
        if name == service.INSTAGRAM_PUBLISH_ITEMS:
            return _FakeQuery(items, item_calls)
        raise AssertionError(f"Unexpected table {name}")

    monkeypatch.setattr(service, "get_sb", lambda: SimpleNamespace(table=table))
    monkeypatch.setattr(
        service,
        "_load_slide_events",
        lambda ids: {
            1: _event(1),
            2: _event(2).model_copy(update={"source_image_url": None}),
        },
    )
    monkeypatch.setattr(
        service,
        "_hydrate_batch",
        Mock(side_effect=AssertionError("list should not hydrate batch details")),
    )

    result, total = service.list_batches(
        batch_status=None,
        local_date=None,
        offset=0,
        limit=25,
    )

    assert total == 12
    assert [batch["item_count"] for batch in result] == [2, 1]
    assert [batch["eligible_count"] for batch in result] == [1, 0]
    assert ("select", ("batch_id,event_id",), {}) in item_calls
    assert ("range", (0, 24), {}) in batch_calls


def test_load_candidates_requires_images_from_any_source(monkeypatch):
    event_calls: list[tuple] = []
    published_calls: list[tuple] = []
    occurrence_calls: list[tuple] = []
    events = [
        {
            "id": 301,
            "title": "Golden Hawk Welcome Social",
            "school": "wlu",
            "ingestion_source": "seed",
            "source_image_url": "https://example.com/poster.jpg",
        },
        {
            "id": 302,
            "title": "Purple and Gold Study Jam",
            "school": "wlu",
            "ingestion_source": "manual",
        },
        {"id": 303, "title": "No poster", "source_image_url": "  "},
    ]
    occurrences = [
        {
            "event_id": 303,
            "dtstart_utc": "2026-08-07T21:00:00+00:00",
            "dtend_utc": None,
            "tz": "America/Toronto",
        },
        {
            "event_id": 301,
            "dtstart_utc": "2026-08-07T21:00:00+00:00",
            "dtend_utc": None,
            "tz": "America/Toronto",
        },
        {
            "event_id": 302,
            "dtstart_utc": "2026-08-11T22:00:00+00:00",
            "dtend_utc": None,
            "tz": "America/Toronto",
        },
    ]

    def table(name: str):
        if name == service.EVENTS:
            return _FakeQuery(events, event_calls)
        if name == service.INSTAGRAM_PUBLISH_ITEMS:
            return _FakeQuery([{"event_id": 302}], published_calls)
        if name == service.EVENT_DATES:
            return _FakeQuery(occurrences, occurrence_calls)
        raise AssertionError(f"Unexpected table {name}")

    monkeypatch.setattr(service, "get_sb", lambda: SimpleNamespace(table=table))
    monkeypatch.setattr(service.school_service, "get_school_id", lambda _school: 10)

    result = service._load_candidates(
        account_key="wlu",
        school="wlu",
        window_start=datetime(2026, 7, 28, 4, tzinfo=timezone.utc),
        window_end=datetime(2026, 7, 28, 15, tzinfo=timezone.utc),
    )

    assert [event["id"] for event in result] == [301]
    assert result[0]["source_image_url"] == "https://example.com/poster.jpg"
    assert ("eq", ("school_id", 10), {}) in event_calls
    assert ("eq", ("cancelled", False), {}) in event_calls
    assert not any(args and args[0] == "ingestion_source" for _, args, _ in event_calls)
    assert not any(args and args[0] == "source_image_url" for _, args, _ in event_calls)


def test_load_candidates_pages_occurrences_and_published_items(monkeypatch):
    events = [
        {"id": event_id, "title": "Event", "source_image_url": "https://example.com/poster.jpg"}
        for event_id in range(1, 1003)
    ]
    occurrences = [
        {
            "event_id": event["id"],
            "dtstart_utc": "2026-08-07T21:00:00+00:00",
            "dtend_utc": None,
            "tz": "America/Toronto",
        }
        for event in events
    ]
    rows = {
        service.EVENTS: events,
        service.EVENT_DATES: occurrences,
        service.INSTAGRAM_PUBLISH_ITEMS: [{"event_id": event_id} for event_id in range(1, 1002)],
    }
    calls = {name: [] for name in rows}
    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(
            table=lambda name: _FakeQuery(rows[name], calls[name]),
        ),
    )

    result = service._load_candidates(
        account_key="wlu",
        school="wlu",
        window_start=datetime(2026, 7, 28, 4, tzinfo=timezone.utc),
        window_end=datetime(2026, 7, 28, 15, tzinfo=timezone.utc),
    )

    assert [event["id"] for event in result] == [1002]
    for table_calls in calls.values():
        assert ("range", (1000, 1999), {}) in table_calls


def test_batch_item_counts_include_every_page(monkeypatch):
    calls = []
    rows = [{"batch_id": "batch-1", "event_id": index} for index in range(1001)]
    monkeypatch.setattr(service, "_load_slide_events", lambda ids: {})
    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(
            table=lambda _name: _FakeQuery(rows, calls),
        ),
    )
    batches = [{"id": "batch-1"}]

    service._attach_item_counts(batches)

    assert batches[0]["item_count"] == 1001
    assert ("range", (1000, 1999), {}) in calls


def _event(event_id: int, title: str = "Event") -> EventSummaryResponse:
    """A slide's event, hydrated exactly as the carousel response carries it."""
    start = datetime(2099, 7, 27, 22, tzinfo=timezone.utc)
    return EventSummaryResponse(
        id=event_id,
        title=title,
        source_image_url="https://example.com/poster.jpg",
        school="uwaterloo",
        added_at=start,
        occurrences=[
            OccurrenceResponse(
                id=uuid4(),
                event_id=event_id,
                dtstart_utc=start,
                tz="America/Toronto",
                created_at=start,
            )
        ],
    )


def _batch(event_ids: list[int], **overrides) -> dict:
    return {
        "id": "batch-1",
        "account_key": "uwaterloo",
        "instagram_user_id": "17841476154506771",
        "school": "uwaterloo",
        "local_date": "2026-07-26",
        "window_start": "2026-07-25T12:30:00+00:00",
        "window_end": "2026-07-27T12:30:00+00:00",
        "status": "ready_for_review",
        "caption": "Caption",
        "cover_body": "Body",
        # Counted on read from the recent-event/carousel union.
        "new_event_count": 20,
        "version": 3,
        "items": [
            {
                "id": f"item-{event_id}",
                "event_id": event_id,
                "position": position,
                "event": _event(event_id),
            }
            for position, event_id in enumerate(event_ids, start=1)
        ],
        **overrides,
    }


@pytest.mark.parametrize("image", [None, "", "   "])
def test_publishable_event_requires_image(image):
    event = _event(1).model_copy(update={"source_image_url": image})
    assert not service._is_publishable_event(event, datetime(2026, 9, 10, tzinfo=timezone.utc))


def test_publishable_event_keeps_ongoing_and_recurring_events():
    now = datetime(2026, 9, 10, tzinfo=timezone.utc)
    event = _event(1)
    past = event.occurrences[0].model_copy(
        update={
            "dtstart_utc": datetime(2026, 9, 8, tzinfo=timezone.utc),
            "dtend_utc": datetime(2026, 9, 9, tzinfo=timezone.utc),
        }
    )
    assert not service._is_publishable_event(event.model_copy(update={"occurrences": [past]}), now)
    ongoing = past.model_copy(update={"dtend_utc": datetime(2026, 9, 11, tzinfo=timezone.utc)})
    assert service._is_publishable_event(event.model_copy(update={"occurrences": [ongoing]}), now)
    assert service._is_publishable_event(
        event.model_copy(update={"occurrences": [past, *event.occurrences]}), now
    )


@pytest.mark.parametrize("status", ["ready_for_review", "failed", "published"])
def test_hydration_excludes_invalid_slides_only_from_drafts(monkeypatch, status):
    batch = _batch([1, 2, 3, 4], status=status)
    items = [{**item, "batch_id": batch["id"]} for item in batch["items"]]
    ended = _event(3)
    ended.occurrences[0].dtstart_utc = datetime(2000, 1, 1, tzinfo=timezone.utc)
    events = {1: _event(1), 2: _event(2).model_copy(update={"source_image_url": None}), 3: ended}
    monkeypatch.setattr(
        service, "get_sb", lambda: SimpleNamespace(table=lambda _name: _FakeQuery(items, []))
    )
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: events)
    monkeypatch.setattr(service, "_count_new_events", lambda _batch: 3)
    monkeypatch.setattr(service, "build_caption", lambda *_: "Caption")
    service._hydrate_batch(batch)
    assert [item["event_id"] for item in batch["items"]] == (
        [1, 2, 3] if status == "published" else [1]
    )
    assert batch["new_event_count"] == 3


def test_hydration_handles_an_empty_batch(monkeypatch):
    batch = _batch([])
    monkeypatch.setattr(service, "_load_batch_items", lambda *_: [])
    load_events = Mock(return_value={})
    monkeypatch.setattr(service, "_load_slide_events", load_events)
    monkeypatch.setattr(service, "_count_new_events", lambda _: 0)
    monkeypatch.setattr(service, "build_caption", lambda *_: "Empty caption")

    service._hydrate_batch(batch)

    assert batch["items"] == []
    assert batch["new_event_count"] == 0
    assert batch["caption"] == "Empty caption"
    load_events.assert_called_once_with([])


@pytest.mark.parametrize("status", ["ready_for_review", "failed", "publishing", "published"])
def test_hydration_refreshes_only_editable_captions(monkeypatch, status):
    batch = _batch([1], status=status)
    batch["caption_intro"] = "Keep my intro"
    items = [{**item, "batch_id": batch["id"]} for item in batch["items"]]
    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(
            table=lambda _name: _FakeQuery(items, []),
        ),
    )
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1, "Updated title")})
    monkeypatch.setattr(service, "_count_new_events", lambda _batch: 1)
    caption = Mock(return_value="Updated caption")
    monkeypatch.setattr(service, "build_caption", caption)

    service._hydrate_batch(batch)

    if status in ("ready_for_review", "failed"):
        assert batch["caption"] == "Updated caption"
        assert caption.call_args.args[0][0]["title"] == "Updated title"
        assert caption.call_args.args[2] == "Keep my intro"
    else:
        assert batch["caption"] == "Caption"
        caption.assert_not_called()


@pytest.fixture
def draft_editor(monkeypatch):
    """Stub every I/O edge of ``update_batch`` and record what it did."""
    calls = {"renders": [], "rpc": [], "table": []}

    class _Rpc:
        def __init__(self, name, params):
            calls["rpc"].append((name, params))

        def execute(self):
            return Mock(data=[{"id": "batch-1"}])

    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(
            rpc=_Rpc,
            table=lambda name: _FakeQuery([{}], calls["table"]),
        ),
    )
    monkeypatch.setattr(
        service,
        "render_event_asset",
        lambda event: calls["renders"].append(int(event["id"])) or "https://a/e.png",
    )
    monkeypatch.setattr(
        service,
        "render_cover_asset",
        lambda events, school, body: calls["renders"].append("cover") or "https://a/cover.png",
    )
    return calls


def test_update_batch_saves_the_carousel_order_without_rendering(monkeypatch, draft_editor):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda _school: "America/Toronto",
    )
    monkeypatch.setattr("services.instagram_publishing.captions.get_school", lambda _school: None)
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([1, 2]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1), 2: _event(2)})

    service.update_batch(
        "batch-1",
        InstagramPublishBatchUpdate(
            version=3, cover_body="Body", caption_intro="Our picks", event_ids=[2, 1]
        ),
    )

    # Images belong to publishing, not to saving a draft.
    assert draft_editor["renders"] == []
    _, params = draft_editor["rpc"][0]
    assert params["p_event_ids"] == [2, 1]
    assert params["p_cover_body"] == "Body"
    assert params["p_caption_intro"] == "Our picks"
    assert params["p_caption"] == service.build_caption(
        [service._slide_payload(_event(2)), service._slide_payload(_event(1))],
        "uwaterloo",
        "Our picks",
    )


@pytest.mark.parametrize("reason", ["missing_image", "ended"])
def test_update_batch_rejects_ineligible_addition_without_saving(monkeypatch, draft_editor, reason):
    event = _event(2)
    if reason == "missing_image":
        event = event.model_copy(update={"source_image_url": None})
    else:
        occurrence = event.occurrences[0].model_copy(
            update={
                "dtstart_utc": datetime(2000, 1, 1, tzinfo=timezone.utc),
                "dtend_utc": datetime(2000, 1, 2, tzinfo=timezone.utc),
            }
        )
        event = event.model_copy(update={"occurrences": [occurrence]})
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([1]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1), 2: event})

    with pytest.raises(Exception, match="Cannot add or save event IDs: 2"):
        service.update_batch("batch-1", InstagramPublishBatchUpdate(version=3, event_ids=[1, 2]))
    assert draft_editor["rpc"] == []


def test_update_batch_rejects_events_without_a_date(monkeypatch, draft_editor):
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {})

    with pytest.raises(Exception, match="dated, existing event"):
        service.update_batch(
            "batch-1",
            InstagramPublishBatchUpdate(version=3, event_ids=[9]),
        )


def test_update_batch_rejects_a_repeated_event(monkeypatch, draft_editor):
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([1]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1)})

    with pytest.raises(Exception, match="different event"):
        service.update_batch(
            "batch-1",
            InstagramPublishBatchUpdate(version=3, event_ids=[1, 1]),
        )


def test_count_new_events_unions_the_carousel_with_the_anchored_recent_window(monkeypatch):
    calls: list[tuple] = []
    queries = iter(
        [
            _FakeQuery([], calls, count=8),
            _FakeQuery([], calls, count=2),
        ]
    )
    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(table=lambda _name: next(queries)),
    )
    monkeypatch.setattr(service.school_service, "get_school_id", lambda _school: 1)

    result = service._count_new_events(_batch([7, 8, 9]))

    # Eight recent events plus three carousel events, with two ids overlapping.
    assert result == 9
    assert calls.count(("gte", ("added_at", "2026-07-26T12:30:00+00:00"), {})) == 2
    assert calls.count(("lt", ("added_at", "2026-07-27T12:30:00+00:00"), {})) == 2
    assert calls.count(("eq", ("school_id", 1), {})) == 2
    assert calls.count(("eq", ("cancelled", False), {})) == 2
    assert ("in_", ("id", [7, 8, 9]), {}) in calls


def test_count_new_events_without_a_carousel_returns_only_the_recent_count(monkeypatch):
    calls: list[tuple] = []
    tables: list[str] = []

    def table(name: str):
        tables.append(name)
        return _FakeQuery([], calls, count=4)

    monkeypatch.setattr(service, "get_sb", lambda: SimpleNamespace(table=table))

    assert service._count_new_events(_batch([])) == 4
    assert tables == ["events"]
    assert not any(name == "in_" for name, _args, _kwargs in calls)


def test_publish_batch_renders_the_slides_from_live_event_data(monkeypatch):
    rendered: list = []
    containers: list[str] = []
    table_calls: list[tuple] = []

    monkeypatch.setattr(service, "_enabled_account_keys", lambda: ["dalhousie"])
    load_credentials = Mock(
        return_value=SimpleNamespace(
            access_token="dalhousie-token",
            instagram_user_id="37640733598873542",
        )
    )
    monkeypatch.setattr(service, "load_account_credentials", load_credentials)
    monkeypatch.setattr(
        service,
        "get_batch",
        lambda _id: _batch(
            [7, 8],
            account_key="dalhousie",
            instagram_user_id="37640733598873542",
            school="dalhousie",
        ),
    )
    monkeypatch.setattr(
        service,
        "get_sb",
        lambda: SimpleNamespace(table=lambda name: _FakeQuery([{}], table_calls)),
    )
    monkeypatch.setattr(
        service,
        "render_event_asset",
        lambda event: rendered.append(int(event["id"])) or f"https://a/{event['id']}.png",
    )
    monkeypatch.setattr(
        service,
        "render_cover_asset",
        lambda events, school, body, *, local_date, new_event_count: (
            rendered.append(
                ("cover", [int(e["id"]) for e in events], school, body, local_date, new_event_count)
            )
            or "https://a/cover.png"
        ),
    )

    class _FakeClient:
        def __init__(self, access_token):
            assert access_token == "dalhousie-token"

        def create_image_container(self, user_id, image_url):
            containers.append(image_url)
            return f"container-{len(containers)}"

        def wait_until_ready(self, container_id):
            return None

        def create_carousel_container(self, user_id, *, child_ids, caption):
            self.child_ids = child_ids
            return "carousel-1"

        def publish(self, user_id, carousel_id):
            return "media-1"

    monkeypatch.setattr(service, "MetaInstagramClient", _FakeClient)

    batch = service.claim_batch_for_publishing("batch-1", InstagramPublishBatchPublish(version=3))
    assert rendered == []
    assert containers == []
    service.publish_claimed_batch(batch)

    assert ("delete", (), {}) in table_calls
    assert ("in_", ("event_id", [7, 8]), {}) in table_calls
    assert ("is_", ("published_at", "null"), {}) in table_calls
    assert load_credentials.call_args.args[0] == "dalhousie"
    assert rendered == [("cover", [7, 8], "dalhousie", "Body", "2026-07-26", 20), 7, 8]
    assert containers == ["https://a/cover.png", "https://a/7.png", "https://a/8.png"]
    published = [call for call in table_calls if call[0] == "update"]
    assert any(fields.get("meta_media_id") == "media-1" for _, (fields,), _ in published)
    # A published run keeps the images it posted; the events behind them move on.
    assert any(
        fields.get("published_cover_url") == "https://a/cover.png" for _, (fields,), _ in published
    )
    assert {
        fields["published_asset_url"]
        for _, (fields,), _ in published
        if "published_asset_url" in fields
    } == {"https://a/7.png", "https://a/8.png"}


def test_background_publish_records_failure(monkeypatch):
    calls = []
    monkeypatch.setattr(
        service, "load_account_credentials", Mock(side_effect=RuntimeError("Invalidated session"))
    )
    monkeypatch.setattr(
        service, "get_sb", lambda: SimpleNamespace(table=lambda _name: _FakeQuery([{}], calls))
    )
    service.publish_claimed_batch(_batch([7], status="publishing"))
    updates = [args[0] for name, args, _ in calls if name == "update"]
    assert updates[0]["status"] == "failed"
    assert updates[0]["error_message"] == "Invalidated session"


def test_publish_route_queues_work_without_rendering(monkeypatch):
    from fastapi import BackgroundTasks

    from routers.instagram_publishing import publish_instagram_batch
    from services import instagram_publishing

    batch = _batch([7], status="publishing", version=4)
    claim = Mock(return_value=batch)
    publish = Mock()
    monkeypatch.setattr(instagram_publishing, "claim_batch_for_publishing", claim)
    monkeypatch.setattr(instagram_publishing, "publish_claimed_batch", publish)
    tasks = BackgroundTasks()
    assert publish_instagram_batch(uuid4(), InstagramPublishBatchPublish(version=3), tasks) is batch
    publish.assert_not_called()
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].func is publish
    assert tasks.tasks[0].args == (batch,)


def test_draft_allows_more_than_nine_events():
    draft = InstagramPublishBatchUpdate(version=3, event_ids=list(range(1, 15)))
    assert len(draft.event_ids) == 14


def test_slide_payload_flattens_the_first_occurrence_for_the_renderer():
    payload = service._slide_payload(_event(7))

    assert payload["id"] == 7
    assert payload["dtstart_utc"] == "2099-07-27T22:00:00+00:00"
    assert payload["tz"] == "America/Toronto"
    # The renderer reads a flat dict; the occurrence list never reaches it.
    assert "occurrences" not in payload


@pytest.mark.parametrize("occurrence_timezone", [None, "America/Toronto", "UTC"])
def test_slide_payload_uses_school_timezone_even_when_occurrence_disagrees(
    monkeypatch, occurrence_timezone
):
    monkeypatch.setattr(
        service,
        "resolve_school_timezone",
        lambda school: "America/Edmonton" if school == "ualberta" else "America/Toronto",
    )
    event = _event(8)
    event.school = "ualberta"
    event.occurrences[0].tz = occurrence_timezone

    assert service._slide_payload(event)["tz"] == "America/Edmonton"
    assert (
        service._with_occurrence(
            {"id": 8},
            {"dtstart_utc": "2099-07-27T22:00:00+00:00", "tz": occurrence_timezone},
            "ualberta",
        )["tz"]
        == "America/Edmonton"
    )
