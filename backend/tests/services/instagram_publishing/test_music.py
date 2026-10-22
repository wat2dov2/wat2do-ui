from datetime import datetime, timezone
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
BATCH = {
    "id": "batch-1",
    "account_key": "uwaterloo",
    "permalink": POST,
    "music_attempts": 0,
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
        "instagram_publishing_accounts": [{"instagram_username": "wat2do.uwaterloo"}],
    }
    calls = []
    monkeypatch.setattr(
        music,
        "get_sb",
        lambda: SimpleNamespace(table=lambda name: _Table(tables[name], calls)),
    )
    return SimpleNamespace(tables=tables, calls=calls)


def _updates(calls):
    return [args[0] for name, args, _ in calls if name == "update"]


def test_pending_carousels_get_a_song_in_random_order(monkeypatch, database):
    add_audio = Mock(return_value=AddedTrack("dua lipa houdini", "Houdini by Dua Lipa,3:05"))
    monkeypatch.setattr(music, "add_audio", add_audio)
    assert music.add_pending_music(NOW) == {"added": 1}
    school, username, permalink, songs, choose = add_audio.call_args.args
    assert (school, username, permalink) == ("uwaterloo", "wat2do.uwaterloo", POST)
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
    assert ("gte", ("published_at", "2026-10-20T18:00:00+00:00"), {}) in database.calls


def test_no_matching_song_fails_at_once(monkeypatch, database):
    monkeypatch.setattr(music, "add_audio", Mock(side_effect=SongNotFound("none")))
    assert music.add_pending_music(NOW) == {"failed": 1}
    assert _updates(database.calls)[0]["music_status"] == "failed"


def test_an_emulator_error_is_retried_until_the_attempts_run_out(monkeypatch, database):
    monkeypatch.setattr(music, "add_audio", Mock(side_effect=RuntimeError("adb went away")))
    assert music.add_pending_music(NOW) == {"pending": 1}
    assert _updates(database.calls)[0]["music_error"] == "adb went away"
    database.tables["instagram_publish_batches"] = [
        {**BATCH, "music_attempts": music._CONTROL.music_attempts - 1}
    ]
    assert music.add_pending_music(NOW) == {"failed": 1}


def test_nothing_runs_without_songs(monkeypatch, database):
    database.tables["instagram_songs"] = []
    add_audio = Mock()
    monkeypatch.setattr(music, "add_audio", add_audio)
    assert music.add_pending_music(NOW) == {}
    add_audio.assert_not_called()


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
    assert ("insert", ({"query": "sza saturn"},), {}) in database.calls


def test_deleting_a_missing_song_is_not_found(database):
    database.tables["instagram_songs"] = []
    with pytest.raises(NotFoundError):
        music.delete_song(uuid4())


@pytest.mark.parametrize("query", ["", "   ", "x" * 201])
def test_blank_or_long_songs_are_rejected(query):
    with pytest.raises(PydanticValidationError):
        InstagramSongCreate(query=query)
