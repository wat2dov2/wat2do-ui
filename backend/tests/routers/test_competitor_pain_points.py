import pytest

from core.errors import COMPETITOR_PAIN_POINT_NOT_FOUND
from core.exceptions import NotFoundError
from schemas.competitor_pain_point import CompetitorPainPointResponse
from services.competitor_pain_points import service

ID = "88888888-8888-4888-8888-888888888881"


def pain_point(status="new"):
    return CompetitorPainPointResponse(
        id=ID,
        competitor="eventbrite",
        source="reddit",
        url="https://www.reddit.com/r/example/comments/seed1/",
        author="club_treasurer",
        quote="Eventbrite took a fee from every free RSVP.",
        pain_point="Fees on free club events",
        audience="organizer",
        found_at="2026-10-19T00:00:00Z",
        status=status,
    )


@pytest.mark.parametrize("fixture, expected", [("client", 401), ("authenticated_client", 403)])
def test_pain_points_are_admin_only(request, fixture, expected):
    client = request.getfixturevalue(fixture)
    assert client.get("/competitor-pain-points/").status_code == expected
    assert client.get("/competitor-pain-points/reports").status_code == expected
    assert client.patch(f"/competitor-pain-points/{ID}", json={"status": "seen"}).status_code == (
        expected
    )


def test_admin_list_forwards_every_filter(admin_client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        service, "list_pain_points", lambda **kwargs: calls.append(kwargs) or ([pain_point()], 7)
    )
    response = admin_client.get(
        "/competitor-pain-points/",
        params={
            "competitor": "eventbrite",
            "source": "reddit",
            "audience": "organizer",
            "pain_point_status": "new",
            "search": "fee",
            "page": 2,
            "page_size": 5,
        },
    )
    assert response.status_code == 200
    assert response.json()["total"] == 7
    assert response.json()["items"][0]["pain_point"] == "Fees on free club events"
    assert calls == [
        {
            "competitor": "eventbrite",
            "source": "reddit",
            "audience": "organizer",
            "status": "new",
            "search": "fee",
            "offset": 5,
            "limit": 5,
        }
    ]


def test_admin_marks_a_pain_point_and_unknown_ids_404(admin_client, monkeypatch):
    monkeypatch.setattr(service, "review_pain_point", lambda _id, status: pain_point(status))
    response = admin_client.patch(f"/competitor-pain-points/{ID}", json={"status": "dismissed"})
    assert response.status_code == 200 and response.json()["status"] == "dismissed"

    def missing(_id, _status):
        raise NotFoundError(COMPETITOR_PAIN_POINT_NOT_FOUND)

    monkeypatch.setattr(service, "review_pain_point", missing)
    assert (
        admin_client.patch(f"/competitor-pain-points/{ID}", json={"status": "seen"}).status_code
        == 404
    )
    assert (
        admin_client.patch(f"/competitor-pain-points/{ID}", json={"status": "replied"}).status_code
        == 422
    )


def test_admin_lists_daily_reports_newest_first(admin_client, monkeypatch):
    from schemas.competitor_pain_point import DailyReportResponse

    report = DailyReportResponse(
        id=ID,
        report_date="2026-10-21",
        model="claude-opus-5-5",
        complaint_count=12,
        summary="Organizers are tired of fees.",
        themes=[],
        suggestions=[
            {
                "title": "Say wat2do is free for clubs",
                "priority": "high",
                "problem": "Fees",
                "change": "Add a line",
                "where": [],
                "complaint_urls": ["https://www.reddit.com/r/example/comments/seed1/"],
            }
        ],
        created_at="2026-10-21T12:00:00Z",
    )
    calls = []
    monkeypatch.setattr(
        service, "list_reports", lambda **kwargs: calls.append(kwargs) or ([report], 1)
    )
    response = admin_client.get(
        "/competitor-pain-points/reports", params={"page": 2, "page_size": 5}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["items"][0]["suggestions"][0]["priority"] == "high"
    assert calls == [{"offset": 5, "limit": 5}]
