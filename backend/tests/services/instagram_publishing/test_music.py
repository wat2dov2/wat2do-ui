from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from uuid import uuid4

import pytest
from pydantic import ValidationError as PydanticValidationError

from core.exceptions import ConflictError, NotFoundError
from schemas.instagram_publishing import InstagramSongCreate
from services.instagram_emulator.audio import AddedTrack, SongNotFound
from services.instagram_publishing import music

NOW = datetime(2026, 10, 21, 18, tzinfo=timezone.utc)
POST = "https://www.instagram.com/p/ABC123/"
DEVICE = object()
BATCH = {
    "id": "batch-1",
    "permalink": POST,
    "music_attempts": 0,
    "updated_at": "2026-10-21T17:00:00+00:00",
    "school_record": {"slug": "uwaterloo"},
}


class _Table:
    """One Supabase table: every call chains, `execute` answers with its rows."""

    def __init__(self, rows, calls):
        self.rows = rows
        self.calls = calls

    def __getattr__(self, name):
        def chain(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return chain

    def execute(self):
        return SimpleNamespace(data=self.rows)


@pytest.fixture
def database(monkeypatch):
    tables = {
        "instagram_songs": [{"query": "the weeknd after hours"}, {"query": "dua lipa houdini"}],
        "instagram_publish_batches": [BATCH],
    }
    calls = []
    monkeypatch.setattr(
        music,
        "get_sb",
        lambda: SimpleNamespace(table=lambda name: _Table(tables[name], calls)),
    )
    return SimpleNamespace(tables=tables, calls=calls)


def _updates(calls):
    return [
        {key: value for key, value in args[0].items() if key != "updated_at"}
        for name, args, _ in calls
        if name == "update"
    ]


def test_pending_carousels_get_a_song_in_random_order(monkeypatch, database):
    finish_post = Mock(return_value=AddedTrack("dua lipa houdini", "Houdini by Dua Lipa,3:05"))
    monkeypatch.setattr(music, "finish_post", finish_post)
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {"added": 1}
    device, school, permalink, songs, choose = finish_post.call_args.args
    assert (device, school, permalink) == (DEVICE, "uwaterloo", POST)
    assert sorted(songs) == ["dua lipa houdini", "the weeknd after hours"]
    assert choose is music.choose_track
    assert _updates(database.calls) == [
        {
            "music_status": "added",
            "music_track": "Houdini by Dua Lipa,3:05",
            "music_error": None,
            "music_attempts": 1,
        }
    ]
    # Only published carousels that have settled, and not ones too old to touch.
    assert ("lte", ("published_at", "2026-10-21T17:55:00+00:00"), {}) in database.calls
    oldest = (NOW - timedelta(hours=music._CONTROL.music_max_age_hours)).isoformat()
    assert ("gte", ("published_at", oldest), {}) in database.calls


def test_no_matching_song_fails_at_once(monkeypatch, database):
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=SongNotFound("none")))
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {"failed": 1}
    assert _updates(database.calls)[0]["music_status"] == "failed"


def test_an_emulator_error_is_retried_until_the_attempts_run_out(monkeypatch, database):
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=RuntimeError("adb went away")))
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {"pending": 1}
    assert _updates(database.calls)[0]["music_error"] == "adb went away"
    database.tables["instagram_publish_batches"] = [
        {**BATCH, "music_attempts": music._CONTROL.music_attempts - 1}
    ]
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {"failed": 1}


def test_a_failed_try_waits_before_the_next(monkeypatch, database):
    finish_post = Mock(return_value=AddedTrack("dua lipa houdini", "Houdini by Dua Lipa,3:05"))
    monkeypatch.setattr(music, "finish_post", finish_post)
    just_tried = (NOW - timedelta(minutes=music._CONTROL.music_retry_minutes - 1)).isoformat()
    database.tables["instagram_publish_batches"] = [
        {**BATCH, "music_attempts": 1, "updated_at": just_tried}
    ]
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {}
    finish_post.assert_not_called()
    waited = (NOW - timedelta(minutes=music._CONTROL.music_retry_minutes)).isoformat()
    database.tables["instagram_publish_batches"] = [
        {**BATCH, "music_attempts": 1, "updated_at": waited}
    ]
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {"added": 1}
    assert "updated_at" in [args[0] for name, args, _ in database.calls if name == "update"][0]


def test_nothing_is_due_without_songs(database):
    assert music.schools_due(NOW) == ["uwaterloo"]
    database.tables["instagram_songs"] = []
    assert music.schools_due(NOW) == []


def test_another_schools_carousel_waits_for_its_own_visit(monkeypatch, database):
    finish_post = Mock()
    monkeypatch.setattr(music, "finish_post", finish_post)
    assert music.finish_due(DEVICE, "uwo", NOW) == {}
    finish_post.assert_not_called()


@pytest.mark.parametrize(
    "answer,chosen",
    [({"index": 1}, 1), ({"index": None}, None), ({"index": 5}, None), ({"index": "1"}, None)],
)
def test_the_track_picker_only_returns_a_listed_track(monkeypatch, answer, chosen):
    monkeypatch.setattr(music, "run_agent", lambda prompt, **_: {**answer, "reason": ""})
    assert music.choose_track("after hours", ["A by B,1:00", "C by D,2:00"]) == chosen


def test_the_track_picker_sees_the_song_and_the_tracks(monkeypatch):
    seen = {}

    def run_agent(prompt, *, workdir, **_):
        seen["prompt"] = prompt
        seen["tracks"] = open(f"{workdir}/tracks.json").read()
        return {"index": 0, "reason": ""}

    monkeypatch.setattr(music, "run_agent", run_agent)
    music.choose_track("the weeknd after hours", ["After Hours by The Weeknd,6:01"])
    assert '"the weeknd after hours"' in seen["prompt"]
    assert seen["tracks"] == '["After Hours by The Weeknd,6:01"]'


def test_songs_are_added_once_regardless_of_case(database):
    with pytest.raises(ConflictError):
        music.add_song("  The Weeknd   AFTER hours ")
    database.tables["instagram_songs"] = [{"id": str(uuid4()), "query": "sza snooze"}]
    music.add_song("sza  saturn")
    assert (
        "insert",
        ({"query": "sza saturn", "asian_campuses_only": False},),
        {},
    ) in database.calls


def test_deleting_a_missing_song_is_not_found(database):
    database.tables["instagram_songs"] = []
    with pytest.raises(NotFoundError):
        music.delete_song(uuid4())


@pytest.mark.parametrize("query", ["", "   ", "x" * 201])
def test_blank_or_long_songs_are_rejected(query):
    with pytest.raises(PydanticValidationError):
        InstagramSongCreate(query=query)


def _tried_songs(monkeypatch, database, school):
    database.tables["instagram_songs"] = [
        {"query": "the weeknd after hours", "asian_campuses_only": False},
        {"query": "bts spring day", "asian_campuses_only": True},
    ]
    database.tables["instagram_publish_batches"] = [{**BATCH, "school_record": {"slug": school}}]
    tried = []
    monkeypatch.setattr(
        music,
        "finish_post",
        lambda _school, _user, _post, songs, _choose: (
            tried.append(sorted(songs)) or AddedTrack(songs[0], "After Hours by The Weeknd")
        ),
    )
    music.finish_due(DEVICE, school, NOW)
    return tried


def test_asian_and_kpop_songs_play_only_on_asian_campuses(monkeypatch, database):
    assert music._CONTROL.asian_song_schools
    assert "uwaterloo" in music._CONTROL.asian_song_schools
    assert _tried_songs(monkeypatch, database, "uwaterloo") == [
        ["bts spring day", "the weeknd after hours"]
    ]
    assert _tried_songs(monkeypatch, database, "queensu") == [["the weeknd after hours"]]


def test_a_campus_with_no_playable_song_is_left_pending(monkeypatch, database):
    database.tables["instagram_songs"] = [{"query": "bts spring day", "asian_campuses_only": True}]
    database.tables["instagram_publish_batches"] = [{**BATCH, "school_record": {"slug": "queensu"}}]
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=AssertionError("no song to try")))
    assert music.finish_due(DEVICE, "uwaterloo", NOW) == {}
    assert _updates(database.calls) == []


def test_a_song_is_stored_with_its_asian_campus_flag(database):
    database.tables["instagram_songs"] = [{"query": "bts spring day", "asian_campuses_only": True}]
    music.add_song("twice  doughnut", asian_campuses_only=True)
    inserted = [args[0] for name, args, _ in database.calls if name == "insert"]
    assert inserted == [{"query": "twice doughnut", "asian_campuses_only": True}]
