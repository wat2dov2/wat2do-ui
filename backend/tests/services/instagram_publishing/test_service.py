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


def test_select_events_orders_by_ai_score_and_limits_each_organization():
    candidates = [
        {
            "id": 1,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        },
        {
            "id": 2,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-26T10:00:00+00:00",
        },
        {
            "id": 3,
            "organization": "Same Club",
            "dtstart_utc": "2026-07-27T10:00:00+00:00",
        },
        {
            "id": 4,
            "organization": "Another Club",
            "dtstart_utc": "2026-07-28T10:00:00+00:00",
        },
    ]
    scores = [
        {"event_id": 1, "overall_score": 9.0},
        {"event_id": 2, "overall_score": 8.0},
        {"event_id": 3, "overall_score": 7.0},
        {"event_id": 4, "overall_score": 6.0},
    ]

    selected = service._select_events(candidates, scores)

    assert [event["id"] for event in selected] == [1, 2, 4]


def test_select_events_filters_below_threshold():
    candidates = [
        {
            "id": 1,
            "organization": "Club",
            "dtstart_utc": "2026-07-25T10:00:00+00:00",
        }
    ]

    assert service._select_events(candidates, [{"event_id": 1, "overall_score": 2.0}]) == []


def test_generate_due_batches_uses_enabled_controlbox_accounts(monkeypatch):
    generated_accounts = []
    enabled_accounts = [account for account in service._CONTROL.accounts if account.enabled]
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
    assert all(account.key != "wat2do" for account in generated_accounts)
    assert any(account.key == "dalhousie" for account in generated_accounts)


def test_generate_due_batches_runs_when_the_scheduler_starts_late(monkeypatch):
    generate = Mock(return_value="generated")
    monkeypatch.setattr(service, "_generate_account_batch", generate)
    monkeypatch.setattr(service, "_batch_exists", lambda *_: False)

    result = service.generate_due_batches(
        datetime(2026, 7, 23, 14, 48, tzinfo=timezone.utc),
    )

    enabled_account_count = sum(account.enabled for account in service._CONTROL.accounts)
    assert result["accounts"] == enabled_account_count
    assert generate.call_count == enabled_account_count


class _FakeQuery:
    """Supabase query builder stub: every call chains, `execute` ends it."""

    def __init__(self, data: list[dict], calls: list[tuple]):
        self._data = data
        self._calls = calls

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self._calls.append((name, args, kwargs))
            return self

        return chain

    def execute(self):
        return SimpleNamespace(data=self._data, count=len(self._data))


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
        "account_key": "wat2do",
        "instagram_user_id": "17841476154506771",
        "school": "uwaterloo",
        "local_date": "2026-07-26",
        "status": "ready_for_review",
        "caption": "Caption",
        "cover_body": "Body",
        # Counted on read from the batch's window; the cover leads with it.
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


def test_publish_batch_renders_the_slides_from_live_event_data(monkeypatch):
    rendered: list = []
    containers: list[str] = []
    table_calls: list[tuple] = []

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

    assert load_credentials.call_args.args[0].key == "dalhousie"
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


def test_slide_payload_falls_back_to_the_school_timezone():
    event = _event(8)
    event.occurrences[0].tz = None

    assert service._slide_payload(event)["tz"] == "America/Toronto"
