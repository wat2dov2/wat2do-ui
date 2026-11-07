from contextlib import nullcontext
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from services import instagram_worker as worker
from services.instagram_follow.follows import FollowVisit

DAY = datetime(2026, 10, 28, 14, 0).astimezone()
NIGHT = datetime(2026, 10, 28, 3, 0).astimezone()


class _Device:
    def __init__(self):
        self.accounts = []

    def adb(self, *args):
        return "0\n"

    def wake(self):
        pass

    def reclaim_data(self):
        return 5000

    def use_android_user(self, user):
        pass

    def use_account(self, user, account):
        self.accounts.append(account)


def _follow_hours(monkeypatch, start: int, end: int) -> None:
    control = worker.CONTROL.model_copy(update={"follow_start_hour": start, "follow_end_hour": end})
    monkeypatch.setattr(worker, "CONTROL", control)


@pytest.fixture
def due(monkeypatch):
    """What each step reports as due; the steps record what they did."""
    state = SimpleNamespace(
        music=[], dms=set(), unfollows=set(), follows=set(), crawls=set(), running=set(), done=[]
    )
    monkeypatch.setattr(worker, "exclusive", nullcontext)
    monkeypatch.setattr(worker, "_crawl_rested_until", {})
    monkeypatch.setattr(worker, "_follows_rested_until", {})
    monkeypatch.setattr(worker, "_score_in_background", lambda: state.done.append("score"))
    monkeypatch.setattr(worker.music, "schools_due", lambda now: list(state.music))
    monkeypatch.setattr(
        worker.music, "finish_due", lambda device, school, now: state.done.append(("music", school))
    )
    monkeypatch.setattr(worker.sweep, "due", lambda school, now: school in state.dms)
    monkeypatch.setattr(
        worker.sweep, "answer", lambda device, school: state.done.append(("dms", school))
    )
    monkeypatch.setattr(worker.follows, "follows_due", lambda school: school in state.follows)
    monkeypatch.setattr(worker.follows, "unfollows_due", lambda school: school in state.unfollows)

    def unfollow_due(device, school, limit):
        state.done.append(("unfollows", school))
        return FollowVisit(followed=1, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "unfollow_due", unfollow_due)

    def follow_due(device, school, limit):
        state.done.append(("follows", school))
        return FollowVisit(followed=1, confirmed=0, blocked=False)

    monkeypatch.setattr(worker.follows, "follow_due", follow_due)
    monkeypatch.setattr(worker.crawl, "crawl_due", lambda school, now: school in state.crawls)
    monkeypatch.setattr(worker.crawl, "crawl_running", lambda school: school in state.running)

    def crawl_slice(device, school, deadline, stop=None):
        state.done.append(("crawl", school))
        return worker.crawl.CRAWL_FINISHED

    monkeypatch.setattr(worker.crawl, "crawl_slice", crawl_slice)
    return state


def test_an_account_with_a_carousel_waiting_is_visited_first_and_gets_everything_due(due):
    due.music = ["uwo"]
    due.dms = {"uwo", "ubc"}
    due.follows = {"uwo"}
    due.crawls = {"uwo"}
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert device.accounts == ["wat2do.uwo"]
    # A crawl waits while other accounts have work; this visit was for the song.
    assert due.done == [("music", "uwo"), ("dms", "uwo"), ("follows", "uwo")]


def test_inboxes_come_before_follows_and_follows_before_crawls(due):
    due.dms = {"ubc"}
    due.follows = {"sfu"}
    due.crawls = {"utm"}
    device = _Device()
    worker.visit_next(device, DAY)
    due.dms.clear()
    worker.visit_next(device, DAY)
    due.follows.clear()
    worker.visit_next(device, DAY)
    assert device.accounts == ["wat2do.ubc", "wat2do.sfu", "wat2do.utm"]
    assert due.done[-2:] == [("crawl", "utm"), "score"]


def test_at_night_the_worker_only_adds_songs_and_crawls(due, monkeypatch):
    _follow_hours(monkeypatch, 9, 23)
    due.music = ["uwo"]
    due.dms = {"uwo"}
    due.follows = {"uwo"}
    due.crawls = {"utm"}
    device = _Device()
    assert worker.visit_next(device, NIGHT)
    assert due.done == [("music", "uwo")]
    due.music = []
    assert worker.visit_next(device, NIGHT)
    assert due.done[1:] == [("crawl", "utm"), "score"]


def test_songs_waiting_elsewhere_come_before_this_accounts_dms_and_follows(due):
    due.music = ["uwo", "ubc"]
    due.dms = {"uwo"}
    due.follows = {"uwo"}
    worker.visit(_Device(), "uwo", acting=True, following=True, crawl_slice=False, now=DAY)
    assert due.done == [("music", "uwo")]


def test_a_crawl_stopped_for_a_song_does_not_rest(due, monkeypatch):
    due.crawls = {"utm"}

    def crawl_slice(device, school, deadline, stop=None):
        due.music = ["ubc"]
        assert stop()
        return worker.crawl.CRAWL_RUNNING

    monkeypatch.setattr(worker.crawl, "crawl_slice", crawl_slice)
    worker.visit(_Device(), "utm", acting=True, following=True, crawl_slice=True, now=DAY)
    assert "utm" not in worker._crawl_rested_until


def test_nothing_due_leaves_the_emulator_alone(due):
    device = _Device()
    assert not worker.visit_next(device, DAY)
    assert device.accounts == []


def test_a_crawl_under_way_finishes_before_another_starts(due):
    due.crawls = {"utm", "utsc", "utsg", "uwo", "ubc"}
    due.running = {"ubc"}
    device = _Device()
    worker.visit_next(device, NIGHT)
    assert device.accounts == ["wat2do.ubc"]


def test_a_crawl_that_gives_up_early_rests_before_its_next_slice(due, monkeypatch):
    due.crawls = {"utm"}
    monkeypatch.setattr(
        worker.crawl, "crawl_slice", lambda device, school, deadline: worker.crawl.CRAWL_RUNNING
    )
    device = _Device()
    assert worker.visit_next(device, NIGHT)
    assert not worker.visit_next(device, NIGHT)
    later = NIGHT + timedelta(seconds=worker.FOLLOW.crawl_rest_seconds)
    assert worker.visit_next(device, later)


def test_follows_that_get_nowhere_rest_instead_of_looping(due, monkeypatch):
    due.follows = {"sfu"}
    monkeypatch.setattr(
        worker.follows,
        "follow_due",
        lambda device, school, limit: FollowVisit(followed=0, confirmed=0, blocked=False),
    )
    device = _Device()
    assert worker.visit_next(device, DAY)
    assert not worker.visit_next(device, DAY)


def test_follows_wait_while_another_carousel_waits_for_its_song(due):
    due.music = ["ubc"]
    due.follows = {"uwo"}
    worker.visit(_Device(), "uwo", acting=True, following=True, crawl_slice=False, now=DAY)
    assert due.done == []
    due.music = []
    worker.visit(_Device(), "uwo", acting=True, following=True, crawl_slice=False, now=DAY)
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
