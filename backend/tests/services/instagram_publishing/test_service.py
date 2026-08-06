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

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self

        return chain

    @property
    def not_(self):
        return self

    def execute(self):
        return SimpleNamespace(data=self._data, count=self._count)


def test_list_batches_attaches_item_counts_without_hydrating_details(monkeypatch):
    batch_calls: list[tuple] = []
    item_calls: list[tuple] = []
    batches = [
        {"id": "batch-1", "school_record": {"slug": "uwaterloo"}},
        {"id": "batch-2", "school_record": {"slug": "wlu"}},
    ]
    items = [
        {"batch_id": "batch-1"},
        {"batch_id": "batch-1"},
        {"batch_id": "batch-2"},
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
        "_hydrate_batches",
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
    assert ("select", ("batch_id",), {}) in item_calls
    assert ("range", (0, 24), {}) in batch_calls


def test_load_candidates_includes_added_events_from_any_source_without_images(monkeypatch):
    event_calls: list[tuple] = []
    published_calls: list[tuple] = []
    occurrence_calls: list[tuple] = []
    events = [
        {
            "id": 301,
            "title": "Golden Hawk Welcome Social",
            "school": "wlu",
            "ingestion_source": "seed",
        },
        {
            "id": 302,
            "title": "Purple and Gold Study Jam",
            "school": "wlu",
            "ingestion_source": "manual",
        },
    ]
    occurrences = [
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
    assert "source_image_url" not in result[0]
    assert ("eq", ("school_id", 10), {}) in event_calls
    assert ("eq", ("cancelled", False), {}) in event_calls
    assert not any(args and args[0] == "ingestion_source" for _, args, _ in event_calls)
    assert not any(args and args[0] == "source_image_url" for _, args, _ in event_calls)


def _event(event_id: int, title: str = "Event") -> EventSummaryResponse:
    """A slide's event, hydrated exactly as the carousel response carries it."""
    start = datetime(2026, 7, 27, 22, tzinfo=timezone.utc)
    return EventSummaryResponse(
        id=event_id,
        title=title,
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
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([1, 2]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1), 2: _event(2)})

    service.update_batch(
        "batch-1",
        InstagramPublishBatchUpdate(
            version=3, caption="Caption", cover_body="Body", event_ids=[2, 1]
        ),
    )

    # Images belong to publishing, not to saving a draft.
    assert draft_editor["renders"] == []
    _, params = draft_editor["rpc"][0]
    assert params["p_event_ids"] == [2, 1]
    assert params["p_cover_body"] == "Body"
    assert params["p_caption"] == "Caption"


def test_update_batch_rejects_events_without_a_date(monkeypatch, draft_editor):
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {})

    with pytest.raises(Exception, match="dated, existing event"):
        service.update_batch(
            "batch-1",
            InstagramPublishBatchUpdate(version=3, caption="Caption", event_ids=[9]),
        )


def test_update_batch_rejects_a_repeated_event(monkeypatch, draft_editor):
    monkeypatch.setattr(service, "get_batch", lambda _id: _batch([1]))
    monkeypatch.setattr(service, "_load_slide_events", lambda _ids: {1: _event(1)})

    with pytest.raises(Exception, match="different event"):
        service.update_batch(
            "batch-1",
            InstagramPublishBatchUpdate(version=3, caption="Caption", event_ids=[1, 1]),
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

    service.publish_batch("batch-1", InstagramPublishBatchPublish(version=3))

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


def test_slide_payload_flattens_the_first_occurrence_for_the_renderer():
    payload = service._slide_payload(_event(7))

    assert payload["id"] == 7
    assert payload["dtstart_utc"] == "2026-07-27T22:00:00+00:00"
    assert payload["tz"] == "America/Toronto"
    # The renderer reads a flat dict; the occurrence list never reaches it.
    assert "occurrences" not in payload


def test_slide_payload_falls_back_to_the_school_timezone(monkeypatch):
    monkeypatch.setattr(
        service,
        "resolve_school_timezone",
        lambda _school: "America/Toronto",
    )
    event = _event(8)
    event.occurrences[0].tz = None

    assert service._slide_payload(event)["tz"] == "America/Toronto"
