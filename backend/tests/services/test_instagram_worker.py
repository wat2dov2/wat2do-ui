import threading
from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from services import instagram_worker as worker
from services.instagram_follow.follows import FollowVisit

DAY = datetime(2026, 10, 28, 14, 0).astimezone()
NIGHT = datetime(2026, 10, 28, 3, 0).astimezone()


class _Device:
    def __init__(self, unreachable=()):
        self.accounts = []
        self.unreachable = set(unreachable)
        self.restarts = 0

    def adb(self, *args):
        return "0\n"

    def wake(self):
        pass

    def reclaim_data(self):
        return 5000

    def use_android_user(self, user):
        pass

    def use_account(self, user, account):
        if account in self.unreachable:
            raise worker.EmulatorError("Instagram did not switch to the account")
        self.accounts.append(account)

    def restart(self):
        self.restarts += 1


def _follow_hours(monkeypatch, start: int, end: int) -> None:
    control = worker.CONTROL.model_copy(update={"follow_start_hour": start, "follow_end_hour": end})
    monkeypatch.setattr(worker, "CONTROL", control)


@pytest.fixture
def due(monkeypatch):
    """What each step reports as due; the steps record what they did."""
    state = SimpleNamespace(
        music=[],
        dms=set(),
        unfollows=set(),
        follows=set(),
        reclaim=False,
        done=[],
    )
    monkeypatch.setattr(worker, "exclusive", nullcontext)
    monkeypatch.setattr(worker, "_follows_rested_until", {})
    monkeypatch.setattr(worker, "_switch_rested_until", {})
    monkeypatch.setattr(worker, "_switch_failures", 0)
    monkeypatch.setattr(worker.music, "schools_due", lambda now: list(state.music))
    monkeypatch.setattr(worker, "reclaim_due", lambda: state.reclaim)
    monkeypatch.setattr(
        worker.music, "finish_due", lambda device, school, now: state.done.append(("music", school))
    )
    monkeypatch.setattr(worker.sweep, "due", lambda school, now: school in state.dms)
    monkeypatch.setattr(
        worker.sweep, "answer", lambda device, school: state.done.append(("dms", school))
    )
    monkeypatch.setattr(worker.follows, "follows_due", lambda school: school in state.follows)
    monkeypatch.setattr(worker.follows, "unfollows_due", lambda school: school in state.unfollows)

    def unfollow_due(device, school, limit, stop=None):
        state.done.append(("unfollows", school))
        return FollowVisit(followed=1, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "unfollow_due", unfollow_due)

    def follow_due(device, school, limit, stop=None):
        state.done.append(("follows", school))
        return FollowVisit(followed=1, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "follow_due", follow_due)
    return state


def test_an_account_with_a_carousel_waiting_is_visited_first_and_gets_everything_due(due):
    due.music = ["uwo"]
    due.dms = {"uwo", "ubc"}
    due.follows = {"uwo"}
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert device.accounts == ["wat2do.uwo"]
    assert due.done == [("music", "uwo"), ("dms", "uwo"), ("follows", "uwo")]


def test_an_account_the_app_cannot_switch_to_rests_while_the_others_get_their_songs(
    due, monkeypatch
):
    monkeypatch.setattr(worker, "_visit_order", lambda current_user: ["utm", "uwo"])
    due.music = ["utm", "uwo"]
    device = _Device(unreachable={"wat2do.utm"})
    # The failed switch neither stops the worker nor gets the song.
    assert worker.visit_next(device, DAY)
    assert due.done == []
    assert worker.visit_next(device, DAY)
    assert due.done == [("music", "uwo")]
    # It is tried again once its rest is over.
    later = DAY + timedelta(seconds=worker.CONTROL.switch_rest_seconds)
    device.unreachable.clear()
    worker.visit_next(device, later)
    assert due.done[-1] == ("music", "utm")


def test_switches_failing_in_a_row_restart_the_emulator(due, monkeypatch):
    in_a_row = worker.CONTROL.switch_failures_before_restart
    *stuck, reachable = sorted(worker.CONTROL.android_user_by_school)[: in_a_row + 1]
    monkeypatch.setattr(worker, "_visit_order", lambda current_user: [*stuck, reachable])
    due.music = [*stuck, reachable]
    device = _Device(unreachable={f"wat2do.{school}" for school in stuck})
    for _ in range(in_a_row - 1):
        worker.visit_next(device, DAY)
    assert device.restarts == 0
    worker.visit_next(device, DAY)
    assert device.restarts == 1
    # A switch that works starts the count over.
    worker.visit_next(device, DAY)
    assert device.accounts == [f"wat2do.{reachable}"]
    assert worker._switch_failures == 0


def test_at_night_the_worker_only_adds_songs(due, monkeypatch):
    _follow_hours(monkeypatch, 9, 23)
    due.music = ["uwo"]
    due.dms = {"uwo"}
    due.follows = {"uwo"}
    device = _Device()
    assert worker.visit_next(device, NIGHT)
    assert due.done == [("music", "uwo")]
    due.music = []
    assert not worker.visit_next(device, NIGHT)


def test_songs_waiting_elsewhere_come_before_this_accounts_dms_and_follows(due):
    due.music = ["uwo", "ubc"]
    due.dms = {"uwo"}
    due.follows = {"uwo"}
    worker.visit(_Device(), "uwo", acting=True, following=True, now=DAY)
    assert due.done == [("music", "uwo")]


def _follows_that_report(monkeypatch, visit: FollowVisit) -> list[str]:
    """Replace the follow step with one that reports ``visit``; returns where it ran."""
    tried: list[str] = []

    def follow_due(device, school, limit, stop=None):
        tried.append(school)
        return visit

    monkeypatch.setattr(worker.follows, "follow_due", follow_due)
    return tried


def test_follows_that_get_nowhere_rest_instead_of_looping(due, monkeypatch):
    due.follows = {"sfu"}
    tried = _follows_that_report(monkeypatch, FollowVisit(followed=0, confirmed=0, blocked=False))
    device = _Device()
    assert worker.visit_next(device, DAY)
    # The next visits wait instead of trying the same follows again.
    assert not worker.visit_next(device, DAY)
    assert tried == ["sfu"]


def test_follows_whose_profiles_keep_failing_rest_even_after_some_went_through(due, monkeypatch):
    due.follows = {"sfu"}
    tried = _follows_that_report(
        monkeypatch, FollowVisit(followed=2, confirmed=0, blocked=False, failing=True)
    )
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert not worker.visit_next(device, DAY)
    assert tried == ["sfu"]
    later = DAY + timedelta(seconds=worker.FOLLOW.rest_seconds)
    assert worker.visit_next(device, later)
    assert tried == ["sfu", "sfu"]


def test_while_a_song_waits_no_other_work_is_looked_up(due, monkeypatch):
    due.music = ["uwo"]
    due.follows = {"ubc"}
    looked_up = []
    monkeypatch.setattr(worker.follows, "follows_due", lambda school: looked_up.append(school))
    monkeypatch.setattr(worker.follows, "unfollows_due", lambda school: looked_up.append(school))
    visited = []
    monkeypatch.setattr(worker, "visit", lambda device, school, **_: visited.append(school))
    assert worker.visit_next(_Device(), DAY)
    assert visited == ["uwo"]
    assert looked_up == []


def test_a_visit_that_fails_outright_never_stops_the_worker(monkeypatch):
    class Stop(Exception):
        pass

    def visit_next(device):
        raise worker.EmulatorError("adb get-state did not complete")

    waits = []

    def sleep(seconds):
        waits.append(seconds)
        raise Stop

    crawls = []
    started = threading.Event()

    def crawl(on_found):
        crawls.append(on_found)
        started.set()
        # The real crawl never returns.
        threading.Event().wait()

    monkeypatch.setattr(worker.crawl, "run_forever", crawl)
    monkeypatch.setattr(worker, "EmulatorDevice", object)
    monkeypatch.setattr(worker.candidates, "sync_club_targets", lambda: None)
    monkeypatch.setattr(worker, "visit_next", visit_next)
    monkeypatch.setattr(worker.time, "sleep", sleep)
    with pytest.raises(Stop):
        worker.run_forever()
    # The emulator may be restarting; the worker waits a little and goes on.
    assert waits == [worker.CONTROL.idle_seconds]
    # The follow crawl runs beside it, scoring what it finds in the background.
    assert started.wait(5)
    assert crawls == [worker._score_in_background]


def test_a_crawl_thread_that_stops_is_logged_and_started_again(monkeypatch, caplog):
    class Stop(BaseException):
        pass

    runs = []

    def run_forever(on_found):
        runs.append(on_found)
        if len(runs) == 1:
            raise RuntimeError("scoring could not start")
        raise Stop

    rests = []
    monkeypatch.setattr(worker.crawl, "run_forever", run_forever)
    monkeypatch.setattr(worker.time, "sleep", rests.append)
    with pytest.raises(Stop):
        worker._crawl_forever()
    assert runs == [worker._score_in_background] * 2
    assert rests == [worker.FOLLOW.rest_seconds]
    assert "starting it again" in caplog.text


def test_follows_stop_for_a_carousel_that_starts_waiting_mid_visit(due, monkeypatch):
    due.follows = {"uwo"}

    def follow_due(device, school, limit, stop=None):
        # A carousel publishes while this account is following.
        due.music = ["ubc"]
        assert stop()
        return FollowVisit(followed=0, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "follow_due", follow_due)
    worker.visit(_Device(), "uwo", acting=True, following=True, now=DAY)
    # The visit ends there, and the account does not rest for having stopped.
    assert "uwo" not in worker._follows_rested_until
    assert worker.visit_next(_Device(), DAY)
    assert due.done[-1] == ("music", "ubc")


def test_follows_stop_for_the_daily_reclaim(due, monkeypatch):
    due.unfollows = {"uwo"}
    due.follows = {"uwo"}

    def unfollow_due(device, school, limit, stop=None):
        due.done.append(("unfollows", school))
        due.reclaim = True
        assert stop()
        return FollowVisit(followed=0, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "unfollow_due", unfollow_due)
    worker.visit(_Device(), "uwo", acting=True, following=True, now=DAY)
    assert due.done == [("unfollows", "uwo")]


def test_a_carousel_whose_account_cannot_be_reached_holds_up_no_other_work(due, monkeypatch):
    monkeypatch.setattr(worker, "_visit_order", lambda current_user: ["utm", "uwo"])
    due.music = ["utm"]
    due.follows = {"uwo"}
    device = _Device(unreachable={"wat2do.utm"})
    assert worker.visit_next(device, DAY)
    # While utm rests, uwo's follows go ahead instead of waiting on utm's song.
    assert worker.visit_next(device, DAY)
    assert due.done == [("follows", "uwo")]


def test_follows_wait_while_another_carousel_waits_for_its_song(due):
    due.music = ["ubc"]
    due.follows = {"uwo"}
    worker.visit(_Device(), "uwo", acting=True, following=True, now=DAY)
    assert due.done == []
    due.music = []
    worker.visit(_Device(), "uwo", acting=True, following=True, now=DAY)
    assert due.done == [("follows", "uwo")]


def test_one_failing_step_does_not_stop_the_rest_of_the_visit(due, monkeypatch):
    due.dms = {"uwo"}
    due.follows = {"uwo"}

    def broken(device, school):
        raise RuntimeError("inbox would not open")

    monkeypatch.setattr(worker.sweep, "answer", broken)
    worker.visit_next(_Device(), DAY)
    assert due.done == [("follows", "uwo")]


def test_unfollows_come_before_follows_in_the_same_visit(due):
    due.unfollows = {"uwo"}
    due.follows = {"uwo"}
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert device.accounts == ["wat2do.uwo"]
    assert due.done == [("unfollows", "uwo"), ("follows", "uwo")]


def test_an_account_with_only_unfollows_is_visited(due):
    due.unfollows = {"sfu"}
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert due.done == [("unfollows", "sfu")]


def test_follows_keep_their_own_hours(due, monkeypatch):
    _follow_hours(monkeypatch, 0, 24)
    due.dms = {"uwo"}
    due.follows = {"uwo"}
    device = _Device()
    assert worker.visit_next(device, NIGHT)
    assert due.done == [("follows", "uwo")]


@pytest.mark.parametrize(("hour", "acting"), [(8, False), (9, True), (22, True), (23, False)])
def test_actions_keep_to_waking_hours(hour, acting):
    assert worker.acting_hours(DAY.replace(hour=hour)) is acting
