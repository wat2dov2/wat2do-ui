import pytest

from core.errors import OUTREACH_LEAD_NOT_FOUND
from core.exceptions import NotFoundError
from schemas.outreach import OutreachLeadResponse
from services.outreach import service

LEAD = "99999999-9999-4999-8999-999999999992"


def lead(status="new"):
    return OutreachLeadResponse(
        id=LEAD,
        lead_type="hackathon",
        school_slug="uwaterloo",
        school_name="University of Waterloo",
        event_name="Example Hacks",
        event_url="https://example.com/hacks",
        organization="Example Hacks",
        email="team@example.com",
        source_url="https://example.com/hacks/contact",
        context="A student hackathon.",
        video_script="Hey team...",
        email_subject="Example Hacks on Wat2Do",
        email_body="Hi team...",
        follow_up="Hi again...",
        status=status,
        notes="",
        found_at="2026-10-22T00:00:00Z",
    )


@pytest.mark.parametrize("fixture, expected", [("client", 401), ("authenticated_client", 403)])
def test_outreach_is_admin_only(request, fixture, expected):
    client = request.getfixturevalue(fixture)
    assert client.get("/outreach/leads/").status_code == expected
    assert (
        client.patch(f"/outreach/leads/{LEAD}", json={"status": "contacted"}).status_code
        == expected
    )


def test_admin_lead_list_forwards_every_filter(admin_client, monkeypatch):
    calls = []
    monkeypatch.setattr(
        service, "list_leads", lambda **kwargs: calls.append(kwargs) or ([lead()], 3)
    )
    response = admin_client.get(
        "/outreach/leads/",
        params={
            "lead_type": "hackathon",
            "lead_status": "new",
            "school": "uwaterloo",
            "search": "hacks",
            "page": 2,
            "page_size": 5,
        },
    )
    assert response.status_code == 200
    assert response.json()["total"] == 3
    assert response.json()["items"][0]["school_name"] == "University of Waterloo"
    assert calls == [
        {
            "lead_type": "hackathon",
            "status": "new",
            "school": "uwaterloo",
            "search": "hacks",
            "offset": 5,
            "limit": 5,
        }
    ]


def test_admin_updates_a_lead_and_unknown_ids_404(admin_client, monkeypatch):
    monkeypatch.setattr(service, "update_lead", lambda _id, data: lead(data.status))
    response = admin_client.patch(f"/outreach/leads/{LEAD}", json={"status": "submitted"})
    assert response.status_code == 200 and response.json()["status"] == "submitted"

    def missing(_id, _data):
        raise NotFoundError(OUTREACH_LEAD_NOT_FOUND)

    monkeypatch.setattr(service, "update_lead", missing)
    assert (
        admin_client.patch(f"/outreach/leads/{LEAD}", json={"status": "replied"}).status_code == 404
    )
    assert admin_client.patch(f"/outreach/leads/{LEAD}", json={"status": "sold"}).status_code == 422
