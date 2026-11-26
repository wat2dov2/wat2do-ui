import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services.claude_code import ClaudeLimited
from services.instagram_emulator.audio import AddedTrack, PlaceTag, SlideTag, SongNotFound
from services.instagram_publishing import music

NOW = datetime(2026, 10, 21, 18, tzinfo=timezone.utc)
POST = "https://www.instagram.com/p/ABC123/"
DEVICE = object()
BATCH = {
    "id": "batch-1",
    "permalink": POST,
    "music_attempts": 0,
    "published_at": "2026-10-21T17:00:00+00:00",
    "school": "uwaterloo",
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


def _override(monkeypatch, songs):
    control = music._CONTROL.model_copy(update={"asian_song_override": songs})
    monkeypatch.setattr(music, "_CONTROL", control)


@pytest.fixture
def database(monkeypatch):
    tables = {
        "instagram_songs": [
            {"query": "bigbang loser", "asian_campuses_only": True},
            {"query": "bts dope", "asian_campuses_only": True},
        ],
        "instagram_publish_batches": [BATCH],
        "instagram_publish_items": [
            {"position": 1, "event": {"ig_handle": "@UWMathSoc"}},
            {"position": 2, "event": {"ig_handle": None}},
            {"position": 3, "event": {"ig_handle": "wat2do.uwaterloo"}},
            {"position": 5, "event": {"ig_handle": "uwcsclub "}},
        ],
    }
    calls = []
    # The tests pick songs from these rows, whatever override the control box has today.
    _override(monkeypatch, [])
    monkeypatch.setattr(
        music,
        "get_sb",
        lambda: SimpleNamespace(table=lambda name: _Table(tables[name], calls)),
    )
    monkeypatch.setattr(
        music.school_service,
        "get_school",
        lambda slug: SimpleNamespace(name="University of Waterloo"),
    )
    return SimpleNamespace(tables=tables, calls=calls)


def _updates(calls):
    return [
        {key: value for key, value in args[0].items() if key != "updated_at"}
        for name, args, _ in calls
        if name == "update"
    ]


def test_a_posted_carousel_gets_a_song_in_rotation_order(monkeypatch, database):
    finish_post = Mock(return_value=AddedTrack("bts dope", "Dope by BTS,3:57"))
    monkeypatch.setattr(music, "finish_post", finish_post)
    assert music.finish(DEVICE, BATCH) == "added"
    device, school, permalink, songs, choose, _gif, place, clubs = finish_post.call_args.args
    assert (device, school, permalink) == (DEVICE, "uwaterloo", POST)
    # Each event slide's club, counting from the cover; never our own account.
    assert clubs == [SlideTag(1, "uwmathsoc"), SlideTag(4, "uwcsclub")]
    assert sorted(songs) == ["bigbang loser", "bts dope"]
    assert choose is music.choose_track
    assert place == PlaceTag("University of Waterloo", music.choose_place)
    assert _updates(database.calls) == [
        {
            "music_status": "added",
            "music_track": "Dope by BTS,3:57",
            "music_error": None,
            "music_attempts": 1,
        }
    ]


def test_no_matching_song_fails_at_once(monkeypatch, database):
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=SongNotFound("none")))
    assert music.finish(DEVICE, BATCH) == "failed"
    assert _updates(database.calls)[0]["music_status"] == "failed"


def test_an_emulator_error_is_retried_until_the_attempts_run_out(monkeypatch, database):
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=RuntimeError("adb went away")))
    assert music.finish(DEVICE, BATCH) == "pending"
    assert _updates(database.calls)[0]["music_error"] == "adb went away"
    last_try = {**BATCH, "music_attempts": music._CONTROL.music_attempts - 1}
    assert music.finish(DEVICE, last_try) == "failed"


def test_claudes_usage_limit_never_gives_a_carousel_up(monkeypatch, database):
    limited = ClaudeLimited("hit Claude's usage limit")
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=limited))
    last_try = music._CONTROL.music_attempts - 1
    assert music.finish(DEVICE, {**BATCH, "music_attempts": last_try}) == "pending"
    assert _updates(database.calls) == [
        {
            "music_status": "pending",
            "music_track": None,
            "music_error": "hit Claude's usage limit",
            "music_attempts": last_try + 1,
        }
    ]


def test_a_campus_with_no_song_to_play_is_left_pending(monkeypatch, database):
    database.tables["instagram_songs"] = [{"query": "bts spring day", "asian_campuses_only": True}]
    monkeypatch.setattr(music, "finish_post", Mock(side_effect=AssertionError("no song to try")))
    assert music.finish(DEVICE, {**BATCH, "school": "queensu"}) == "no_songs"
    assert _updates(database.calls) == []


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


def test_the_track_picker_passes_claudes_usage_limit_on(monkeypatch):
    def limited(prompt, **_):
        raise ClaudeLimited("hit Claude's usage limit")

    monkeypatch.setattr(music, "run_agent", limited)
    with pytest.raises(ClaudeLimited):
        music.choose_track("after hours", ["A by B,1:00"])


def test_the_place_listed_under_the_schools_exact_name_is_picked_without_claude(monkeypatch):
    monkeypatch.setattr(music, "run_agent", Mock(side_effect=AssertionError("no question")))
    places = ["Queens University Bookstore", "QUEEN’S UNIVERSITY", "Queen's University"]
    assert music.choose_place("Queen's University", places) == 1
    assert music.choose_place("Université Laval", ["Universite Laval"]) == 0


def test_claude_picks_the_school_listed_under_another_name(monkeypatch):
    seen = {}

    def run_agent(prompt, *, workdir, **_):
        seen["prompt"] = prompt
        seen["places"] = open(f"{workdir}/places.json").read()
        return {"index": 1, "reason": "students call it Western"}

    monkeypatch.setattr(music, "run_agent", run_agent)
    places = ["Western University Bookstore", "Western University"]
    assert music.choose_place("University of Western Ontario", places) == 1
    assert "University of Western Ontario" in seen["prompt"]
    assert seen["places"] == '["Western University Bookstore", "Western University"]'


def test_without_claude_the_post_stays_untagged(monkeypatch):
    def limited(prompt, **_):
        raise ClaudeLimited("hit Claude's usage limit")

    monkeypatch.setattr(music, "run_agent", limited)
    assert music.choose_place("University of Western Ontario", ["Western University"]) is None


def test_a_school_that_cannot_be_read_gets_no_place(monkeypatch):
    def broken(slug):
        raise RuntimeError("data API down")

    monkeypatch.setattr(music.school_service, "get_school", broken)
    assert music._place_tag("uwaterloo") is None


def _tried_songs(monkeypatch, database, school):
    database.tables["instagram_songs"] = [
        {"query": "the weeknd after hours", "asian_campuses_only": False},
        {"query": "bts spring day", "asian_campuses_only": True},
    ]
    tried = []
    monkeypatch.setattr(
        music,
        "finish_post",
        lambda _school, _user, _post, songs, _choose, _gif=None, _place=None, _clubs=(): (
            tried.append(sorted(songs)) or AddedTrack(songs[0], "After Hours by The Weeknd")
        ),
    )
    music.finish(DEVICE, {**BATCH, "school": school})
    return tried


def test_asian_campuses_play_only_asian_and_kpop_songs(monkeypatch, database):
    assert music._CONTROL.asian_song_schools
    assert "uwaterloo" in music._CONTROL.asian_song_schools
    assert _tried_songs(monkeypatch, database, "uwaterloo") == [["bts spring day"]]
    assert _tried_songs(monkeypatch, database, "queensu") == [["the weeknd after hours"]]


def test_the_asian_song_override_replaces_the_asian_songs_only(monkeypatch, database):
    _override(monkeypatch, ["the weeknd - hong kong"])
    assert _tried_songs(monkeypatch, database, "uwaterloo") == [["the weeknd - hong kong"]]
    assert _tried_songs(monkeypatch, database, "queensu") == [["the weeknd after hours"]]


SONGS = [f"song {n}" for n in range(7)]


def test_every_school_tries_the_same_song_first_on_the_same_day():
    day = datetime(2026, 11, 14).date()
    tries = music.rotation(SONGS, day)
    assert sorted(tries) == sorted(SONGS)
    assert music.rotation(list(reversed(SONGS)), day) == tries


def test_the_rotation_moves_one_song_on_each_day():
    days = [datetime(2026, 11, 14).date() + timedelta(days=n) for n in range(len(SONGS))]
    firsts = [music.rotation(SONGS, day)[0] for day in days]
    assert sorted(firsts) == sorted(SONGS)
    tomorrow = music.rotation(SONGS, days[1])
    assert tomorrow == music.rotation(SONGS, days[0])[1:] + music.rotation(SONGS, days[0])[:1]


def test_a_retry_after_midnight_keeps_the_posting_days_song():
    # 23:40 in Toronto on the 14th, whenever the retry runs.
    assert music._posting_day("2026-11-15T04:40:00+00:00") == datetime(2026, 11, 14).date()


def test_only_the_first_try_comments_a_gif(monkeypatch, database):
    asked = []
    monkeypatch.setattr(music, "gif_comment", lambda batch_id: asked.append(batch_id) or "gif")
    finish_post = Mock(return_value=AddedTrack("q", "t"))
    monkeypatch.setattr(music, "finish_post", finish_post)
    music.finish(DEVICE, {**BATCH, "music_attempts": 0})
    music.finish(DEVICE, {**BATCH, "music_attempts": 1})
    first, retry = (call.args[5] for call in finish_post.call_args_list)
    # Claude names the scene while the post opens; the edit asks for it when it is needed.
    assert first() == "gif"
    assert retry is None
    assert asked == [BATCH["id"]]


def test_no_fitting_scene_means_no_gif(monkeypatch):
    monkeypatch.setattr(music, "_first_event", lambda batch_id: {"title": "AGM"})
    monkeypatch.setattr(
        music, "run_agent", lambda prompt, **_: {"query": None, "reason": "no scene"}
    )
    assert music.gif_comment("batch-1") is None


def test_the_scene_picker_sees_recent_searches_and_each_new_one_is_remembered(
    monkeypatch, tmp_path
):
    recent_path = tmp_path / "recent.json"
    recent_path.write_text('["cillian murphy sigh", "jim halpert stare"]')
    monkeypatch.setattr(music, "RECENT_GIFS_PATH", recent_path)
    monkeypatch.setattr(music, "_first_event", lambda batch_id: {"title": "Trivia Night"})
    shown = []

    def agent(prompt, workdir, **_):
        shown.append((Path(workdir) / "recent.json").read_text())
        return {"query": "keanu reeves  tired exhale", "reason": "dry"}

    monkeypatch.setattr(music, "run_agent", agent)
    comment = music.gif_comment("batch-1")
    assert comment is not None and comment.query == "keanu reeves tired exhale"
    assert json.loads(shown[0]) == ["cillian murphy sigh", "jim halpert stare"]
    assert json.loads(recent_path.read_text()) == [
        "cillian murphy sigh",
        "jim halpert stare",
        "keanu reeves tired exhale",
    ]


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
