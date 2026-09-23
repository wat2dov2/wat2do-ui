from types import SimpleNamespace
from uuid import uuid4

import pytest

from core.exceptions import ValidationError
from core.tables import DISCOVERY_QUERIES
from schemas.discovery_query import DiscoveryQueryCreate
from services import discovery_query_service


def query():
    return DiscoveryQueryCreate(
        id=uuid4(),
        school="uwaterloo",
        surface="clubs",
        search_query="@missing.club",
        page_url="https://uwaterloo.wat2do.io/clubs",
        filters={"categories": ["Social"], "minEvents": 0},
    )


def test_capture_resolves_school_fk_and_retries_without_overwriting(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.discovery_query_service")
    monkeypatch.setattr(
        discovery_query_service.school_service, "get_school", lambda slug: SimpleNamespace(id=7)
    )
    data = query()
    discovery_query_service.record_query(data)
    discovery_query_service.record_query(data)
    fake_sb.table.assert_called_with(DISCOVERY_QUERIES)
    expected = {**data.model_dump(mode="json", exclude={"school"}), "school_id": 7}
    assert fake_sb.upsert.call_count == 2
    for call in fake_sb.upsert.call_args_list:
        assert call.args == (expected,)
        assert call.kwargs == {"on_conflict": "id", "ignore_duplicates": True}


def test_unknown_school_does_not_write(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.discovery_query_service")
    monkeypatch.setattr(discovery_query_service.school_service, "get_school", lambda slug: None)
    with pytest.raises(ValidationError, match="school"):
        discovery_query_service.record_query(query())
    fake_sb.upsert.assert_not_called()


def test_write_failure_propagates_for_background_retry(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.discovery_query_service")
    monkeypatch.setattr(
        discovery_query_service.school_service, "get_school", lambda slug: SimpleNamespace(id=7)
    )
    fake_sb.raise_on_execute(RuntimeError("offline"))
    with pytest.raises(RuntimeError, match="offline"):
        discovery_query_service.record_query(query())


def test_admin_page_has_school_filter_stable_order_and_json(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.discovery_query_service")
    monkeypatch.setattr(discovery_query_service.school_service, "get_school_id", lambda slug: 7)
    data = query()
    fake_sb.set_response(
        data=[
            {
                **data.model_dump(mode="json", exclude={"school"}),
                "school_record": {"slug": "uwaterloo"},
                "created_at": "2026-09-22T12:00:00Z",
            }
        ],
        count=31,
    )
    rows, count = discovery_query_service.list_queries(
        offset=20, limit=10, school="uwaterloo", search="missing"
    )
    assert count == 31
    assert rows[0].school == "uwaterloo"
    assert rows[0].filters == data.filters
    assert rows[0].search_query == "@missing.club"
    fake_sb.eq.assert_called_once_with("school_id", 7)
    fake_sb.ilike.assert_called_once_with("search_query", "%missing%")
    fake_sb.range.assert_called_once_with(20, 29)
    assert [call.args[0] for call in fake_sb.order.call_args_list] == ["created_at", "id"]


def test_unknown_school_does_not_return_other_schools(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.discovery_query_service")
    monkeypatch.setattr(discovery_query_service.school_service, "get_school_id", lambda slug: None)
    assert discovery_query_service.list_queries(
        offset=0, limit=20, school="missing", search=None
    ) == ([], 0)
    fake_sb.execute.assert_not_called()
