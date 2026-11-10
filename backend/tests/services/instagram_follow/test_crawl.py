import random
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.instagram_emulator.device import EmulatorError
from services.instagram_emulator.following import FollowingRow
from services.instagram_follow import crawl as module


class _Reader:
    """Following lists by profile; a profile listed in ``failing`` fails to load once each."""

    def __init__(self, lists, failing=()):
        self.lists = lists
        self.failing = list(failing)
        self.visits = []

    def search_following(self, username, terms):
        self.visits.append(username)
        if username in self.failing:
            self.failing.remove(username)
            raise EmulatorError("Instagram profile never loaded")
        return self.lists.get(username, [])


@pytest.fixture
def world(monkeypatch, tmp_path):
    added = []
    progress = []
    monkeypatch.setattr(module, "STATE_DIRECTORY", tmp_path)
    monkeypatch.setattr(module.school_service, "get_school_id", lambda school: 7)
    monkeypatch.setattr(module.candidates, "known_handles", lambda school_id: {"rejected.utm"})
    monkeypatch.setattr(
        module.candidates,
        "add_candidate",
        lambda school_id, handle, **kwargs: added.append((handle, kwargs)),
    )
    monkeypatch.setattr(module, "_record_progress", lambda state, **extra: progress.append(extra))
    # The school's matches keep the order Instagram lists them in, unless a test
    # shuffles them with a seeded generator.
    monkeypatch.setattr(module, "random", SimpleNamespace(shuffle=lambda matches: None))

    def load(school):
        path = module._state_path(school)
        if path.exists():
            return module.json.loads(path.read_text())
        state = {
            "crawl_id": "crawl-1",
            "school_id": 7,
            "seeded": False,
            "queue": [],
            "done": [],
            "failures": {},
            "streak": 0,
            "visited": 0,
            "found": 0,
        }
        module._save(school, state)
        return state

    monkeypatch.setattr(module, "_load", load)

    def use(reader, streak=2):
        monkeypatch.setattr(module, "FollowingReader", lambda *args, **kwargs: reader)
        monkeypatch.setattr(
            module, "CONTROL", module.CONTROL.model_copy(update={"crawl_miss_streak": streak})
        )
        return added, progress

    return use


def _rows(*rows):
    return [FollowingRow(username, name, followed) for username, name, followed in rows]


def test_a_crawl_snowballs_through_followed_clubs_and_records_new_accounts_only(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True), ("someone", "Unrelated", True)),
            "utmmsa": _rows(
                ("utmchess", "UTM Chess", True),
                ("utmaclub", "UTMAC", False),
                ("rejected.utm", "Rejected UTM", False),
            ),
        }
    )
    added, progress = world(reader)

    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED

    assert [handle for handle, _ in added] == ["utmaclub"]
    assert added[0][1] == {"source": "crawl", "name": "UTMAC", "found_via": ["utmmsa"]}
    # Only the matches the school follows are searched in turn; a new candidate waits
    # for a later crawl, once the school follows it.
    assert reader.visits == ["wat2do.utm", "utmmsa", "utmchess"]
    assert progress[-1]["status"] == "finished"
    assert not module._state_path("utm").exists()


def test_a_load_failure_is_retried_and_never_counts_as_a_miss(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True)),
            "utmmsa": _rows(("utmaclub", "UTMAC", False)),
        },
        failing=["utmmsa"],
    )
    added, _ = world(reader, streak=1)

    module.crawl_slice(object(), "utm", deadline=float("inf"))

    assert reader.visits[:3] == ["wat2do.utm", "utmmsa", "utmmsa"]
    assert [handle for handle, _ in added] == ["utmaclub"]


def test_the_deadline_keeps_the_crawls_place(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True)),
            "utmmsa": _rows(("utmaclub", "UTMAC", False)),
        }
    )
    world(reader)

    assert module.crawl_slice(object(), "utm", deadline=0) == module.CRAWL_RUNNING
    assert module.json.loads(module._state_path("utm").read_text())["queue"] == ["utmmsa"]
    assert module.crawl_running("utm")

    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED
    assert reader.visits == ["wat2do.utm", "utmmsa"]
    assert not module.crawl_running("utm")


def test_only_names_of_the_school_are_followed_further(world):
    reader = _Reader(
        {"wat2do.utm": _rows(("utmmsa", "UTM MSA", True), ("pizza", "Pizza Place", False))}
    )
    added, _ = world(reader)

    module.crawl_slice(object(), "utm", deadline=float("inf"))

    assert reader.visits == ["wat2do.utm", "utmmsa"]
    assert added == []


def test_uoft_campuses_search_each_others_names():
    assert module.search_terms("utsg") == ["utsg", "uoft", "utm", "utsc"]
    assert module.search_terms("sfu") == ["sfu"]


@pytest.mark.parametrize(
    ("latest", "finished"),
    [
        ([], None),
        (
            [{"finished_at": "2026-10-25T06:30:00+00:00"}],
            datetime(2026, 10, 25, 6, 30, tzinfo=timezone.utc),
        ),
    ],
)
def test_a_schools_last_crawl_finished_when_its_newest_finished_crawl_ended(
    fake_sb, patch_sb, monkeypatch, latest, finished
):
    patch_sb("services.instagram_follow.crawl")
    monkeypatch.setattr(module.school_service, "get_school_id", lambda school: 7)
    fake_sb.set_response(data=latest)

    assert module.last_crawl_finished("utm") == finished
    # A crawl still under way has not finished, so it never counts.
    fake_sb.eq.assert_any_call("school_id", 7)
    fake_sb.eq.assert_any_call("status", "finished")
    fake_sb.order.assert_called_once_with("finished_at", desc=True)


def test_a_crawl_that_ended_starts_over_from_the_schools_own_following_list(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True)),
            "utmmsa": _rows(("utmchess", "UTM Chess", False)),
        }
    )
    added, progress = world(reader)
    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED
    assert not module.crawl_running("utm")

    # Since then the school followed utmchess, which follows a club created after the crawl.
    reader.lists = {
        "wat2do.utm": _rows(("utmmsa", "UTM MSA", True), ("utmchess", "UTM Chess", True)),
        "utmmsa": _rows(("utmchess", "UTM Chess", True)),
        "utmchess": _rows(("utmboardgames", "UTM Board Games", False)),
    }
    reader.visits.clear()
    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED

    assert reader.visits == ["wat2do.utm", "utmmsa", "utmchess"]
    assert [handle for handle, _ in added] == ["utmchess", "utmboardgames"]
    assert [extra["status"] for extra in progress if extra] == ["finished", "finished"]


def test_each_crawl_takes_the_schools_matches_in_a_new_order(world, monkeypatch):
    clubs = [f"utm{number}" for number in range(6)]
    world(_Reader({"wat2do.utm": _rows(*((club, club.upper(), True) for club in clubs))}))
    monkeypatch.setattr(module, "random", random.Random(4))

    def start() -> list[str]:
        assert module.crawl_slice(object(), "utm", deadline=0) == module.CRAWL_RUNNING
        path = module._state_path("utm")
        queue = module.json.loads(path.read_text())["queue"]
        # The crawl ends, so the next slice starts a new one.
        path.unlink()
        return queue

    first, second = start(), start()
    # Every match is still queued, but in a new order, so a crawl the miss streak ends
    # early reaches clubs the last one never did.
    assert sorted(first) == sorted(second) == clubs
    assert first != second


def test_a_crawl_slice_stops_for_a_waiting_song_and_keeps_its_place(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True)),
            "utmmsa": _rows(("utmaclub", "UTMAC", False)),
        }
    )
    world(reader)

    result = module.crawl_slice(object(), "utm", deadline=float("inf"), stop=lambda: True)

    assert result == module.CRAWL_RUNNING
    assert module.json.loads(module._state_path("utm").read_text())["queue"] == ["utmmsa"]


def test_only_misses_in_a_row_end_a_crawl_before_its_clubs_run_out(world):
    clubs = [f"utm{number}" for number in range(6)]
    lists = {"wat2do.utm": _rows(*((club, club.upper(), True) for club in clubs))}
    # Every club but the last few turns up an account the school has no row for yet.
    for club in clubs[:3]:
        lists[club] = _rows((f"{club}.new", "New UTM club", False))
    reader = _Reader(lists)
    added, _ = world(reader, streak=2)

    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED

    assert [handle for handle, _ in added] == ["utm0.new", "utm1.new", "utm2.new"]
    assert reader.visits == ["wat2do.utm", "utm0", "utm1", "utm2", "utm3", "utm4"]
