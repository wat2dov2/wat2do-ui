from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.instagram_publishing import stats
from services.instagram_publishing.credentials import InstagramAccountCredentials

NOW = datetime(2026, 10, 24, 11, tzinfo=timezone.utc)
PROFILE = {
    "id": "1784",
    "username": "wat2do.uwaterloo",
    "name": "wat2do Waterloo",
    "profile_picture_url": "https://cdn.example/pic.jpg",
    "followers_count": 1200,
    "follows_count": 300,
    "media_count": 88,
}
MEDIA = [
    {
        "id": "1790",
        "media_type": "CAROUSEL_ALBUM",
        "media_product_type": "FEED",
        "caption": "Fresh events",
        "media_url": "https://cdn.example/1790.jpg",
        "permalink": "https://www.instagram.com/p/ABC123/",
        "timestamp": "2026-10-23T13:59:50+0000",
        "like_count": 41,
        "comments_count": 3,
    },
    {
        "id": "1791",
        "media_type": "VIDEO",
        "media_product_type": "REELS",
        "media_url": "https://cdn.example/1791.mp4",
        "thumbnail_url": "https://cdn.example/1791.jpg",
        "permalink": "https://www.instagram.com/reel/DEF456/",
        "timestamp": "2026-10-22T13:59:50+0000",
        "like_count": 9,
        "comments_count": 0,
    },
]


class _Query:
    """One Supabase query: every call chains, `execute` answers with the table's rows."""

    def __init__(self, name, tables, calls):
        self.name, self.tables, self.calls = name, tables, calls

    @property
    def not_(self):
        self.calls.append((self.name, "not_", ()))
        return self

    def __getattr__(self, method):
        def chain(*args, **kwargs):
            self.calls.append((self.name, method, args))
            return self

        return chain

    def execute(self):
        return SimpleNamespace(data=self.tables.get(self.name, []))


@pytest.fixture
def database(monkeypatch):
    tables, calls = {}, []
    monkeypatch.setattr(
        stats,
        "get_sb",
        lambda: SimpleNamespace(table=lambda name: _Query(name, tables, calls)),
    )
    return SimpleNamespace(tables=tables, calls=calls)


@pytest.fixture
def graph(monkeypatch):
    monkeypatch.setattr(
        stats,
        "load_account_credentials",
        lambda key, now_utc: InstagramAccountCredentials(
            account_key=key,
            school=key,
            instagram_user_id="1784",
            instagram_username="wat2do.uwaterloo",
            access_token="secret-token",
            expires_at=NOW,
        ),
    )
    client = SimpleNamespace(
        get_profile=lambda: dict(PROFILE), list_recent_media=lambda limit: MEDIA
    )
    monkeypatch.setattr(stats, "MetaInstagramClient", lambda token: client)
    return client


def _calls(database, table, method):
    return [args for name, called, args in database.calls if name == table and called == method]


def test_snapshot_records_the_day_and_replaces_the_newest_posts(database, graph):
    stats.snapshot_account("uwaterloo", NOW)
    [(snapshot,)] = [args[:1] for args in _calls(database, "instagram_account_snapshots", "upsert")]
    assert snapshot["captured_on"] == "2026-10-24"
    assert snapshot["followers_count"] == 1200
    [(rows,)] = [args[:1] for args in _calls(database, "instagram_account_media", "upsert")]
    # A reel shows its thumbnail, never the video file.
    assert [row["image_url"] for row in rows] == [
        "https://cdn.example/1790.jpg",
        "https://cdn.example/1791.jpg",
    ]
    assert _calls(database, "instagram_account_media", "in_") == [("media_id", ["1790", "1791"])]


def test_snapshot_refuses_a_token_for_another_account(database, graph):
    graph.get_profile = lambda: {**PROFILE, "id": "9999"}
    with pytest.raises(RuntimeError, match="identity"):
        stats.snapshot_account("uwaterloo", NOW)
    assert _calls(database, "instagram_account_snapshots", "upsert") == []


def test_one_failing_account_does_not_stop_the_rest(database, monkeypatch):
    database.tables["instagram_publishing_accounts"] = [
        {"account_key": "ubc"},
        {"account_key": "uwaterloo"},
    ]

    def snapshot(key, now):
        if key == "ubc":
            raise RuntimeError("Graph API down")

    monkeypatch.setattr(stats, "snapshot_account", snapshot)
    assert stats.snapshot_accounts(NOW) == {"captured": 1, "failed": 1}
    assert (
        "instagram_publishing_accounts",
        "eq",
        ("requires_reauthorization", False),
    ) in database.calls


def test_dashboard_joins_history_posts_and_songs(database):
    database.tables.update(
        instagram_publishing_accounts=[
            {
                "account_key": "ubc",
                "instagram_username": "wat2do.ubc",
                "requires_reauthorization": True,
                "expires_at": "2026-11-09T00:00:00Z",
            },
            {
                "account_key": "uwaterloo",
                "instagram_username": "wat2do.uwaterloo",
                "requires_reauthorization": False,
                "expires_at": "2026-11-09T00:00:00Z",
            },
        ],
        instagram_account_snapshots=[
            {
                **{k: v for k, v in PROFILE.items() if k != "id"},
                "account_key": "uwaterloo",
                "captured_on": "2026-10-23",
                "followers_count": 1180,
                "captured_at": "2026-10-23T11:00:00Z",
            },
            {
                **{k: v for k, v in PROFILE.items() if k != "id"},
                "account_key": "uwaterloo",
                "captured_on": "2026-10-24",
                "captured_at": "2026-10-24T11:00:00Z",
            },
        ],
        instagram_account_media=[{**stats._media_row("uwaterloo", item, NOW)} for item in MEDIA],
        instagram_publish_batches=[
            {"meta_media_id": "1790", "music_status": "added", "music_track": "Houdini by Dua Lipa"}
        ],
    )
    ubc, waterloo = stats.list_account_stats(NOW)
    assert ubc["requires_reauthorization"] and ubc["followers_count"] is None and ubc["posts"] == []
    assert waterloo["followers_count"] == 1200
    assert [day["followers_count"] for day in waterloo["followers_history"]] == [1180, 1200]
    assert [post.get("music_track") for post in waterloo["posts"]] == ["Houdini by Dua Lipa", None]
    assert ("instagram_account_snapshots", "gte", ("captured_on", "2026-09-25")) in database.calls
