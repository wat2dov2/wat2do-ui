from uuid import uuid4

import pytest

from services.instagram_follow import candidates

CANDIDATE = {
    "id": str(uuid4()),
    "school": "utsg",
    "handle": "utmaclub",
    "name": "UTMAC",
    "source": "crawl",
    "found_via": ["rocsaut"],
    "status": "pending",
    "read_status": "ok",
    "followers_count": 436,
    "posts_count": 68,
    "score": 82,
    "verdict": "approve",
    "reason": "Weekly mahjong nights",
}


@pytest.mark.parametrize("fixture, expected", [("client", 401), ("authenticated_client", 403)])
def test_follow_candidates_are_admin_only(request, fixture, expected):
    client = request.getfixturevalue(fixture)
    assert client.get("/instagram-publishing/follow-candidates/").status_code == expected
    decisions = {"decisions": [{"id": CANDIDATE["id"], "status": "approved"}]}
    assert (
        client.post("/instagram-publishing/follow-candidates/decisions", json=decisions).status_code
        == expected
    )


def test_admin_pages_through_pending_candidates_of_a_school(admin_client, monkeypatch):
    calls = []

    def list_candidates(**kwargs):
        calls.append(kwargs)
        return [CANDIDATE], 41

    monkeypatch.setattr(candidates, "list_candidates", list_candidates)

    response = admin_client.get(
        "/instagram-publishing/follow-candidates/?school=utsg&page=2&page_size=20"
    )

    assert response.status_code == 200
    body = response.json()
    assert (body["total"], body["total_pages"]) == (41, 3)
    assert (body["items"][0]["handle"], body["items"][0]["score"]) == ("utmaclub", 82)
    assert calls == [{"school": "utsg", "status": "pending", "offset": 20, "limit": 20}]


def test_admin_submits_every_staged_decision_at_once(admin_client, monkeypatch):
    seen = []

    def decide(decisions, *, decided_by):
        seen.append((decisions, decided_by))
        return {"approved": 1, "rejected": 1}

    monkeypatch.setattr(candidates, "decide", decide)
    approved, rejected = uuid4(), uuid4()

    response = admin_client.post(
        "/instagram-publishing/follow-candidates/decisions",
        json={
            "decisions": [
                {"id": str(approved), "status": "approved"},
                {"id": str(rejected), "status": "rejected"},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"approved": 1, "rejected": 1}
    assert seen[0][0] == [(approved, "approved"), (rejected, "rejected")]


@pytest.mark.parametrize("decisions", [[], [{"id": str(uuid4()), "status": "followed"}]])
def test_only_approvals_and_rejections_are_accepted(admin_client, decisions):
    response = admin_client.post(
        "/instagram-publishing/follow-candidates/decisions", json={"decisions": decisions}
    )
    assert response.status_code == 422
