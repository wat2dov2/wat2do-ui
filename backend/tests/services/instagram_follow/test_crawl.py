from datetime import datetime, timedelta, timezone

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


def test_a_crawl_snowballs_through_clubs_and_records_new_accounts_only(world):
    reader = _Reader(
        {
            "wat2do.utm": _rows(("utmmsa", "UTM MSA", True), ("someone", "Unrelated", True)),
            "utmmsa": _rows(("utmaclub", "UTMAC", False), ("rejected.utm", "Rejected UTM", False)),
        }
    )
    added, progress = world(reader)

    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED

    assert [handle for handle, _ in added] == ["utmaclub"]
    assert added[0][1] == {"source": "crawl", "name": "UTMAC", "found_via": ["utmmsa"]}
    # Every match is followed further, accounts we follow and rejected ones included.
    assert reader.visits == ["wat2do.utm", "utmmsa", "utmaclub", "rejected.utm"]
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

    assert module.crawl_slice(object(), "utm", deadline=float("inf")) == module.CRAWL_FINISHED
    assert reader.visits == ["wat2do.utm", "utmmsa", "utmaclub"]


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
    ("latest", "due"),
    [
        ([], True),
        ([{"started_at": "2026-10-20T00:00:00+00:00"}], True),
        ([{"started_at": "2026-10-25T00:00:00+00:00"}], False),
    ],
)
def test_a_school_is_due_a_week_after_its_last_crawl_started(
    fake_sb, patch_sb, monkeypatch, tmp_path, latest, due
):
    patch_sb("services.instagram_follow.crawl")
    monkeypatch.setattr(module, "STATE_DIRECTORY", tmp_path)
    monkeypatch.setattr(module.school_service, "get_school_id", lambda school: 7)
    fake_sb.set_response(data=latest)

    now = datetime(2026, 10, 28, tzinfo=timezone.utc)
    assert module.crawl_due("utm", now) is due


def test_a_crawl_under_way_is_always_due(monkeypatch, tmp_path):
    monkeypatch.setattr(module, "STATE_DIRECTORY", tmp_path)
    (tmp_path / "utm.json").write_text("{}")

    assert module.crawl_due("utm", datetime.now(timezone.utc) + timedelta(days=1))
