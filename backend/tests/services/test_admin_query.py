from unittest.mock import Mock

import pytest

from core.tables import ADMIN_LIST_ENTRIES, EVENT_SUBMISSIONS
from services import admin_query, club_service, report_service, submission_service


@pytest.mark.parametrize(
    "resource", ["events", "reports", "submissions", "claims", "clubSubmissions"]
)
def test_admin_page_filters_before_bounded_selection(fake_sb, patch_sb, resource):
    patch_sb("services.admin_query")
    fake_sb.set_response(data=[{"id": "7"}, {"id": "2"}], count=13086)

    ids, total = admin_query.load_page_ids(
        resource,
        offset=20,
        limit=20,
        search="  Dance  ",
        school="ulaval",
        status="pending",
        category="Social",
    )

    assert (ids, total) == (["7", "2"], 13086)
    fake_sb.table.assert_called_once_with(ADMIN_LIST_ENTRIES)
    fake_sb.select.assert_called_once_with("id", count="exact")
    fake_sb.eq.assert_any_call("resource", resource)
    fake_sb.eq.assert_any_call("school", "ulaval")
    fake_sb.eq.assert_any_call("status", "pending")
    fake_sb.eq.assert_any_call("category", "Social")
    fake_sb.ilike.assert_called_once_with("search_text", "%Dance%")
    fake_sb.order.assert_any_call("sort_at", desc=resource != "events")
    fake_sb.order.assert_any_call("id")
    fake_sb.range.assert_called_once_with(20, 39)
    fake_sb.execute.assert_called_once()


def test_hydration_loads_only_selected_ids_and_restores_order(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.admin_query")
    monkeypatch.setattr(admin_query, "load_page_ids", Mock(return_value=(["7", "2"], 99)))
    fake_sb.set_response(data=[{"id": 2}, {"id": 7}])

    rows, total = admin_query.load_page_rows(
        "submissions", EVENT_SUBMISSIONS, "*", offset=20, limit=20
    )

    assert rows == [{"id": 7}, {"id": 2}]
    assert total == 99
    fake_sb.in_.assert_called_once_with("id", ["7", "2"])
    fake_sb.execute.assert_called_once()


def test_empty_page_does_not_hydrate_all_rows(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.admin_query")
    monkeypatch.setattr(admin_query, "load_page_ids", Mock(return_value=([], 19)))

    assert admin_query.load_page_rows(
        "submissions", EVENT_SUBMISSIONS, "*", offset=20, limit=20
    ) == ([], 19)
    fake_sb.execute.assert_not_called()


def test_search_preserves_email_punctuation(fake_sb, patch_sb):
    patch_sb("services.admin_query")
    admin_query.load_page_ids("claims", offset=0, limit=20, search=" person.name@example.com ")
    fake_sb.ilike.assert_called_once_with("search_text", "%person.name@example.com%")


def test_report_page_carries_event_title_and_school(monkeypatch):
    monkeypatch.setattr(
        admin_query,
        "load_page_rows",
        Mock(
            return_value=(
                [
                    {
                        "id": "report-1",
                        "event_id": 7,
                        "user_id": None,
                        "reason": "Wrong location",
                        "status": "pending",
                        "reported_at": "2026-09-14T12:00:00Z",
                        "events": {"title": "Laval Dance", "school_record": {"slug": "ulaval"}},
                    }
                ],
                21,
            )
        ),
    )
    items, total = report_service.get_reports(offset=20, limit=20, school="ulaval")
    assert total == 21
    assert items[0].event_title == "Laval Dance"
    assert items[0].school == "ulaval"


def test_club_reviews_batch_owner_emails(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.club_service")
    rows = [
        {"id": id, "club_name": f"Club {id}", "created_by": "owner", "club_type": "independent"}
        for id in [1, 2]
    ]
    monkeypatch.setattr(admin_query, "load_page_rows", Mock(return_value=(rows, 21)))
    fake_sb.set_response(data=[{"id": "owner", "email": "owner@example.com"}])
    items, total = club_service.list_club_submissions(offset=0, limit=20)
    assert total == 21
    assert [item.owner_email for item in items] == ["owner@example.com", "owner@example.com"]
    fake_sb.in_.assert_called_once_with("id", ["owner"])
    fake_sb.execute.assert_called_once()


def test_submission_page_batches_club_names_without_full_club_list(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.submission_service")
    rows = [
        {
            "id": "submission-1",
            "user_id": None,
            "status": "pending",
            "submitted_at": "2026-09-14T12:00:00Z",
            "event_data": {"title": "Dance", "club_id": 7},
            "school_record": {"slug": "ulaval"},
            "users": {"email": "person@example.com"},
        }
    ]
    loader = Mock(return_value=(rows, 123))
    monkeypatch.setattr(admin_query, "load_page_rows", loader)
    fake_sb.set_response(data=[{"id": 7, "club_name": "Laval Dance"}])

    items, total = submission_service.get_submissions(
        offset=20, limit=20, school="ulaval", search="Dance"
    )

    assert total == 123
    assert items[0].club_name == "Laval Dance"
    assert items[0].school == "ulaval"
    assert items[0].submitted_by_email == "person@example.com"
    assert loader.call_args.kwargs["offset"] == 20
    fake_sb.in_.assert_called_once_with("id", [7])
    fake_sb.execute.assert_called_once()
