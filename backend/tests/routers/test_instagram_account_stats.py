import pytest

from services.instagram_publishing import stats

ACCOUNT = {
    "account_key": "uwaterloo",
    "username": "wat2do.uwaterloo",
    "followers_count": 1200,
    "requires_reauthorization": False,
    "token_expires_at": "2026-11-09T17:01:24Z",
    "followers_history": [{"captured_on": "2026-10-24", "followers_count": 1200}],
    "posts": [
        {
            "media_id": "1790",
            "media_type": "CAROUSEL_ALBUM",
            "permalink": "https://www.instagram.com/p/ABC123/",
            "posted_at": "2026-10-23T13:59:50Z",
            "like_count": 41,
            "comments_count": 3,
            "music_status": "added",
            "music_track": "Houdini by Dua Lipa",
        }
    ],
}


@pytest.mark.parametrize("fixture, expected", [("client", 401), ("authenticated_client", 403)])
def test_account_stats_are_admin_only(request, fixture, expected):
    client = request.getfixturevalue(fixture)
    assert client.get("/instagram-publishing/accounts/").status_code == expected


def test_admin_reads_every_account_at_once(admin_client, monkeypatch):
    monkeypatch.setattr(stats, "list_account_stats", lambda: [ACCOUNT])
    response = admin_client.get("/instagram-publishing/accounts/")
    assert response.status_code == 200
    [account] = response.json()
    assert account["followers_count"] == 1200
    assert account["posts"][0]["music_track"] == "Houdini by Dua Lipa"
    assert account["posts"][0]["caption"] is None
