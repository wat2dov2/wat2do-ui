from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

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
    """One data API table: every call chains, `execute` answers with its rows."""

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
    device, school, permalink, songs, choose, _gif = finish_post.call_args.args
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
    assert ("lte", ("published_at", "2026-10-21T17:59:00+00:00"), {}) in database.calls
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
        lambda _school, _user, _post, songs, _choose, _gif=None: (
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


def test_only_the_first_try_comments_a_gif(monkeypatch, database):
    asked = []
    monkeypatch.setattr(music, "gif_comment", lambda batch_id: asked.append(batch_id) or "gif")
    finish_post = Mock(return_value=AddedTrack("q", "t"))
    monkeypatch.setattr(music, "finish_post", finish_post)
    music._add_music(DEVICE, {**BATCH, "school": "uwaterloo", "music_attempts": 0}, ["q"])
    music._add_music(DEVICE, {**BATCH, "school": "uwaterloo", "music_attempts": 1}, ["q"])
    assert [call.args[5] for call in finish_post.call_args_list] == ["gif", None]
    assert asked == [BATCH["id"]]


def test_no_fitting_scene_means_no_gif(monkeypatch):
    monkeypatch.setattr(music, "_first_event", lambda batch_id: {"title": "AGM"})
    monkeypatch.setattr(
        music, "run_agent", lambda prompt, **_: {"query": None, "reason": "no scene"}
    )
    assert music.gif_comment("batch-1") is None


def test_the_picker_reads_numbered_results(monkeypatch):
    import io

    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (1080, 2400), (0, 0, 0)).save(buffer, format="PNG")
    seen = {}

    def run_agent(prompt, *, workdir, **_):
        from pathlib import Path

        seen["files"] = sorted(path.name for path in Path(workdir).iterdir())
        seen["prompt"] = prompt
        return {"index": 1, "reason": "Casino Royale table"}

    monkeypatch.setattr(music, "run_agent", run_agent)
    boxes = [(40, 320, 532, 625), (548, 320, 1040, 623)]
    assert (
        music.pick_gif({"title": "Poker Night"}, "casino royale poker", buffer.getvalue(), boxes)
        == 1
    )
    assert seen["files"] == ["event.json", "results.png"]
    assert "casino royale poker" in seen["prompt"]
