import json
import random
import subprocess
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.instagram_follow import crawl as module


def _user(username, name="", private=False):
    return {
        "username": username,
        "full_name": name,
        "pk": str(abs(hash(username)) % 10**9 + 1),
        "is_private": private,
    }


class _Brave:
    """The Brave worker's queue: each Following read finishes at once from ``lists``.

    A list is a list of pages (lists of users). A name in ``failing`` fails that many
    reads first, one in ``hidden`` is never shown, and ``holding`` keeps reads waiting.
    """

    def __init__(self, lists):
        self.lists = lists
        self.failing = {}
        self.hidden = set()
        self.holding = False
        self.pruned = set()
        self.jobs = {}
        self.reads = []

    def __call__(self, *arguments):
        command, *options = arguments
        values = dict(option.removeprefix("--").split("=", 1) for option in options)
        if command == "status":
            job_id = values["job-id"]
            if job_id in self.pruned:
                raise module.BrowserQueueError("Instagram browser job does not exist")
            return self.jobs[job_id]
        assert command == "following"
        username, max_id = values["username"], values.get("max-id")
        self.reads.append((username, values.get("user-id"), max_id))
        job_id = f"job-{len(self.reads)}"
        self.jobs[job_id] = self._finish(username, max_id)
        return {"job_id": job_id}

    def _finish(self, username, max_id):
        if self.holding:
            return {"state": "pending", "result": None}
        if self.failing.get(username):
            self.failing[username] -= 1
            return {"state": "failed", "error": "Instagram Following read failed", "result": None}
        if username in self.hidden:
            return {"state": "succeeded", "result": {"username": username, "hidden": True}}
        pages = self.lists.get(username, [[]])
        index = int(max_id or 0)
        more = index + 1 < len(pages)
        return {
            "state": "succeeded",
            "result": {
                "username": username,
                "user_id": "900",
                "users": pages[index],
                "next_max_id": str(index + 1) if more else None,
            },
        }


@pytest.fixture
def world(monkeypatch, tmp_path):
    added = []
    progress = []
    monkeypatch.setattr(module, "STATE_DIRECTORY", tmp_path)
    monkeypatch.setattr(module, "_rested_until", {})
    monkeypatch.setattr(module, "_known", {})
    monkeypatch.setattr(module.school_service, "get_school_id", lambda school: 7)
    monkeypatch.setattr(
        module.school_service,
        "get_school_by_id",
        lambda school_id: SimpleNamespace(recipient_id="12345"),
    )
    monkeypatch.setattr(module.candidates, "known_handles", lambda school_id: {"rejected.utm"})
    monkeypatch.setattr(
        module.candidates,
        "add_candidate",
        lambda school_id, handle, **kwargs: added.append((handle, kwargs)),
    )
    monkeypatch.setattr(module, "_start_crawl", lambda school_id: f"crawl-{len(progress)}")
    monkeypatch.setattr(module, "_record_progress", lambda state, **extra: progress.append(extra))
    monkeypatch.setattr(module, "last_crawl_finished", lambda school: None)
    # The school's clubs keep the order Instagram lists them in, unless a test shuffles
    # them with a seeded generator.
    monkeypatch.setattr(module, "random", SimpleNamespace(shuffle=lambda clubs: None))

    def use(lists, **controls):
        brave = _Brave(lists)
        monkeypatch.setattr(module, "_browser", brave)
        control = {"crawl_miss_streak": 5, "crawl_mutual_follow_threshold": 2, **controls}
        monkeypatch.setattr(module, "CONTROL", module.CONTROL.model_copy(update=control))
        return brave, added, progress

    return use


def _crawl(school="utm", steps=500):
    """Step the school's crawl until it ends; how many candidates its steps added."""
    found = 0
    for _ in range(steps):
        found += module._Crawl(school, module._load(school)).step()
        if not module.crawl_running(school):
            return found
    raise AssertionError("the crawl never ended")


def _state(school="utm"):
    return json.loads(module._state_path(school).read_text())


def _read_seeds(brave):
    return [username for username, _, max_id in brave.reads if max_id is None]


def test_whole_lists_find_named_accounts_and_accounts_two_clubs_follow(world):
    brave, added, progress = world(
        {
            "wat2do.utm": [
                [
                    _user("utmmsa", "UTM MSA"),
                    _user("utmchess", "UTM Chess"),
                    _user("private.club", private=True),
                    _user("wat2do.utsg"),
                ]
            ],
            "utmmsa": [
                [
                    _user("utmaclub", "UTMAC"),
                    _user("qjarts", "Journal of Arts"),
                    _user("member", "A Member", private=True),
                    _user("utmchess", "UTM Chess"),
                    _user("rejected.utm", "Rejected UTM"),
                    _user("wat2do.utm"),
                ]
            ],
            "utmchess": [[_user("qjarts", "Journal of Arts"), _user("member", private=True)]],
        }
    )

    assert _crawl() == 2

    assert added == [
        ("utmaclub", {"source": "crawl", "name": "UTMAC", "found_via": ["utmmsa"]}),
        (
            "qjarts",
            {"source": "crawl", "name": "Journal of Arts", "found_via": ["utmchess", "utmmsa"]},
        ),
    ]
    # The school's own list is read by its Instagram ID; only its public clubs are seeds.
    assert brave.reads[0] == ("wat2do.utm", "12345", None)
    assert _read_seeds(brave) == ["wat2do.utm", "utmmsa", "utmchess"]
    assert progress[-1]["status"] == "finished"
    assert not module.crawl_running("utm")


def test_accounts_followed_by_two_clubs_are_counted_across_crawls(world):
    brave, added, _ = world(
        {
            "wat2do.utm": [[_user("utmmsa")]],
            "utmmsa": [[_user("qjarts", "Journal of Arts")]],
        }
    )
    _crawl()
    assert added == []

    # Since then the school followed utmnew, which follows the same account.
    brave.lists["wat2do.utm"] = [[_user("utmmsa"), _user("utmnew")]]
    brave.lists["utmnew"] = [[_user("qjarts", "Journal of Arts")]]
    _crawl()

    assert added == [
        (
            "qjarts",
            {"source": "crawl", "name": "Journal of Arts", "found_via": ["utmmsa", "utmnew"]},
        )
    ]


def test_the_threshold_is_a_control_value(world):
    _, added, _ = world(
        {
            "wat2do.utm": [[_user("one"), _user("two"), _user("three")]],
            "one": [[_user("club.x")]],
            "two": [[_user("club.x")]],
            "three": [[_user("club.x")]],
        },
        crawl_mutual_follow_threshold=3,
    )
    _crawl()
    assert added == [
        ("club.x", {"source": "crawl", "name": "", "found_via": ["one", "three", "two"]})
    ]


def test_a_list_is_read_page_by_page_and_counts_as_one_club(world):
    brave, added, progress = world(
        {
            "wat2do.utm": [[_user("utmmsa")], [_user("utmchess")]],
            "utmmsa": [[_user("someone")], [_user("utmaclub", "UTMAC")], [_user("nobody")]],
        }
    )
    _crawl()

    assert brave.reads[:5] == [
        ("wat2do.utm", "12345", None),
        ("wat2do.utm", "900", "1"),
        ("utmmsa", _user("utmmsa")["pk"], None),
        ("utmmsa", "900", "1"),
        ("utmmsa", "900", "2"),
    ]
    assert [handle for handle, _ in added] == ["utmaclub"]
    assert progress[0] == {}
    assert _read_seeds(brave) == ["wat2do.utm", "utmmsa", "utmchess"]


def test_a_list_is_read_at_most_the_page_limit_deep(world):
    brave, _, _ = world(
        {"wat2do.utm": [[_user("utmmsa")]], "utmmsa": [[_user(f"a{page}")] for page in range(5)]},
        crawl_list_page_limit=2,
    )
    _crawl()
    assert [max_id for username, _, max_id in brave.reads if username == "utmmsa"] == [None, "1"]


def test_a_failed_page_is_read_again_and_never_counts_as_a_miss(world):
    brave, added, _ = world(
        {
            "wat2do.utm": [[_user("utmmsa")]],
            "utmmsa": [[_user("someone")], [_user("utmaclub", "UTMAC")]],
        },
        crawl_miss_streak=1,
    )
    brave.failing = {"utmmsa": 1}
    _crawl()

    # The first page failed and was read again; the list still turned up its club.
    assert [max_id for username, _, max_id in brave.reads if username == "utmmsa"] == [
        None,
        None,
        "1",
    ]
    assert [handle for handle, _ in added] == ["utmaclub"]


def test_reads_failing_in_a_row_rest_the_schools_crawl(world):
    brave, _, _ = world({"wat2do.utm": [[_user("utmmsa")]]}, failures_before_rest=2)
    brave.failing = {"wat2do.utm": 2}
    for _ in range(3):
        module._Crawl("utm", module._load("utm")).step()

    assert len(brave.reads) == 2
    assert module._rested_until["utm"] > 0
    assert module.next_school() != "utm"
    assert _state()["reading"]["seed"] == "wat2do.utm"


def test_a_club_whose_list_stays_hidden_is_given_up_without_a_miss(world):
    brave, _, progress = world(
        {"wat2do.utm": [[_user("hidden.club"), _user("utmmsa")]], "utmmsa": [[]]},
        crawl_seed_attempts=2,
        crawl_miss_streak=1,
    )
    brave.hidden = {"hidden.club"}
    _crawl()

    assert _read_seeds(brave) == ["wat2do.utm", "hidden.club", "hidden.club", "utmmsa"]
    # Only utmmsa was read; it alone was visited and missed.
    assert progress[-1]["status"] == "finished"


def test_a_read_held_by_the_worker_keeps_the_crawl_waiting(world):
    brave, _, _ = world({"wat2do.utm": [[_user("utmmsa")]]})
    brave.holding = True
    for _ in range(3):
        assert module._Crawl("utm", module._load("utm")).step() == 0

    assert brave.reads == [("wat2do.utm", "12345", None)]
    assert _state()["job"] == "job-1"


def test_a_read_the_queue_no_longer_has_is_read_again(world):
    brave, _, _ = world({"wat2do.utm": [[_user("utmmsa")]]})
    brave.holding = True
    module._Crawl("utm", module._load("utm")).step()
    brave.pruned.add("job-1")
    brave.holding = False
    module._Crawl("utm", module._load("utm")).step()

    assert brave.reads == [("wat2do.utm", "12345", None)] * 2


def test_only_misses_in_a_row_end_a_crawl_before_its_clubs_run_out(world):
    clubs = [f"utm{number}" for number in range(6)]
    lists = {"wat2do.utm": [[_user(club) for club in clubs]]}
    # Every club but the last few turns up an account the school has no row for yet.
    for club in clubs[:3]:
        lists[club] = [[_user(f"{club}.new", "New UTM club")]]
    brave, added, _ = world(lists, crawl_miss_streak=2)

    _crawl()

    assert [handle for handle, _ in added] == ["utm0.new", "utm1.new", "utm2.new"]
    assert _read_seeds(brave) == ["wat2do.utm", "utm0", "utm1", "utm2", "utm3", "utm4"]


def test_each_crawl_takes_the_schools_clubs_in_a_new_order(world, monkeypatch):
    clubs = [f"utm{number}" for number in range(6)]
    world({"wat2do.utm": [[_user(club) for club in clubs]]})
    monkeypatch.setattr(module, "random", random.Random(4))

    def start() -> list[str]:
        for _ in range(2):
            module._Crawl("utm", module._load("utm")).step()
        state = _state()
        order = [state["reading"]["seed"], *(username for username, _ in state["queue"])]
        # The crawl ends, so the next step starts a new one.
        module._state_path("utm").unlink()
        return order

    first, second = start(), start()
    # Every club is still read, but in a new order, so a crawl the miss streak ends
    # early reaches clubs the last one never did.
    assert sorted(first) == sorted(second) == clubs
    assert first != second


def test_crawling_goes_round_every_school_in_turn(world, monkeypatch):
    monkeypatch.setattr(
        module,
        "EMULATOR",
        module.EMULATOR.model_copy(
            update={"android_user_by_school": {"ubc": 0, "sfu": 0, "utm": 0}}
        ),
    )
    finished = {
        "ubc": datetime(2026, 11, 1, tzinfo=timezone.utc),
        "sfu": datetime(2026, 10, 1, tzinfo=timezone.utc),
    }
    monkeypatch.setattr(module, "last_crawl_finished", finished.get)
    world({})
    # Never crawled first, then the crawl that finished longest ago.
    assert module.next_school() == "utm"
    module._save("ubc", {"running": True})
    assert module.next_school() == "ubc"
    module._rested_until["ubc"] = module.time.monotonic() + 600
    assert module.next_school() == "utm"


def test_the_crawl_thread_scores_after_new_accounts_and_rests_after_a_failure(world, monkeypatch):
    class Stop(Exception):
        pass

    outcomes = iter([2, RuntimeError("database down"), 0])
    sleeps = []
    scored = []

    def advance():
        outcome = next(outcomes)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    def sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) == 3:
            raise Stop

    monkeypatch.setattr(module, "advance", advance)
    monkeypatch.setattr(module.time, "sleep", sleep)
    with pytest.raises(Stop):
        module.run_forever(lambda: scored.append(True))
    assert scored == [True]
    assert sleeps == [
        module.CONTROL.crawl_poll_seconds,
        module.CONTROL.rest_seconds,
        module.CONTROL.crawl_poll_seconds,
    ]


def test_the_worker_queue_is_asked_through_its_installed_binary(monkeypatch):
    calls = []

    def run(arguments, **kwargs):
        calls.append(arguments)
        if arguments[1] == "status":
            return subprocess.CompletedProcess(
                arguments, 1, "", "Instagram browser job does not exist\n"
            )
        return subprocess.CompletedProcess(arguments, 0, '{"job_id": "abc"}', "")

    monkeypatch.setattr(module.subprocess, "run", run)
    assert module._browser("following", "--school=utm") == {"job_id": "abc"}
    assert calls[0] == [str(module.INSTAGRAM_BROWSER_BINARY), "following", "--school=utm"]
    assert module._job("abc") is None

    monkeypatch.setattr(
        module.subprocess,
        "run",
        lambda arguments, **kwargs: subprocess.CompletedProcess(arguments, 2, "", "boom"),
    )
    with pytest.raises(module.BrowserQueueError, match="boom"):
        module._job("abc")


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
    brave, added, progress = world(
        {
            "wat2do.utm": [[_user("utmmsa")]],
            "utmmsa": [[_user("utmchess", "UTM Chess")]],
        }
    )
    _crawl()
    assert not module.crawl_running("utm")

    # Since then the school followed utmchess, which follows a club created after the crawl.
    brave.lists = {
        "wat2do.utm": [[_user("utmmsa"), _user("utmchess")]],
        "utmmsa": [[_user("utmchess", "UTM Chess")]],
        "utmchess": [[_user("utmboardgames", "UTM Board Games")]],
    }
    brave.reads.clear()
    _crawl()

    assert _read_seeds(brave) == ["wat2do.utm", "utmmsa", "utmchess"]
    assert [handle for handle, _ in added] == ["utmchess", "utmboardgames"]
    assert [extra["status"] for extra in progress if extra] == ["finished", "finished"]
