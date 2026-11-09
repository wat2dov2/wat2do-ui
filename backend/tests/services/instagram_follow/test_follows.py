from datetime import datetime, timedelta

import pytest

from services.instagram_emulator.device import EmulatorError
from services.instagram_emulator.following import (
    ActionBlocked,
    FollowedWithoutBell,
    FollowOutcome,
)
from services.instagram_follow import follows as module
from services.instagram_follow.follows import FollowVisit


class _Reader:
    def __init__(self, results):
        self.results = results
        self.followed = []
        self.unfollowed = []

    def unfollow(self, handle):
        self.unfollowed.append(handle)
        result = self.results.get(handle, True)
        if isinstance(result, Exception):
            raise result
        return result

    def follow(self, handle):
        self.followed.append(handle)
        result = self.results.get(handle, FollowOutcome("Following", tapped=True))
        if isinstance(result, Exception):
            raise result
        return result


@pytest.fixture
def world(monkeypatch, tmp_path):
    marks = []
    monkeypatch.setattr(module, "BLOCKS_PATH", tmp_path / "blocked.json")
    monkeypatch.setattr(module.school_service, "get_school_id", lambda school: 7)
    monkeypatch.setattr(module, "_allowance", lambda school_id: 2)
    monkeypatch.setattr(
        module.candidates,
        "approved",
        lambda school_id, limit: [{"id": str(n), "handle": f"club{n}"} for n in range(limit)],
    )
    monkeypatch.setattr(
        module.candidates,
        "mark_followed",
        lambda candidate_id, tapped: marks.append(
            ("followed" if tapped else "confirmed", candidate_id)
        ),
    )
    monkeypatch.setattr(
        module.candidates,
        "to_unfollow",
        lambda school_id, limit: [{"id": str(n), "handle": f"club{n}"} for n in range(limit)],
    )
    monkeypatch.setattr(
        module.candidates,
        "mark_unfollowed",
        lambda candidate_id, tapped: marks.append(
            ("unfollowed" if tapped else "gone", candidate_id)
        ),
    )
    monkeypatch.setattr(
        module.candidates,
        "mark_follow_failed",
        lambda candidate_id, error, tapped=False: marks.append(
            ("followed without bell" if tapped else "failed", candidate_id)
        ),
    )

    monkeypatch.setattr(
        module.candidates, "reject_gone", lambda candidate_id: marks.append(("gone", candidate_id))
    )

    def use(results=None):
        reader = _Reader(results or {})
        monkeypatch.setattr(module, "FollowingReader", lambda *args, **kwargs: reader)
        return reader, marks

    return use


def test_a_visit_follows_no_more_than_asked(world):
    reader, marks = world()

    assert module.follow_due(object(), "utsg", 1) == FollowVisit(1, 0, False)
    assert reader.followed == ["club0"]
    assert marks == [("followed", "0")]


def test_a_visit_stops_at_what_today_still_allows(world):
    reader, _ = world()

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)
    assert reader.followed == ["club0", "club1"]


def test_a_failed_follow_stays_approved_for_the_next_try(world):
    reader, marks = world(
        {"club0": EmulatorError("Instagram never confirmed the follow"), "club1": None}
    )

    # A failure takes no follow slot, so the visit moves on to the next accounts.
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)
    # A profile that is gone is rejected for good; any other failure is tried again.
    assert marks == [("failed", "0"), ("gone", "1"), ("followed", "2"), ("followed", "3")]


def test_profiles_failing_in_a_row_end_the_visit(world):
    broken = EmulatorError("Instagram profile never loaded")
    reader, _ = world({f"club{n}": broken for n in range(20)})

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(0, 0, False, failing=True)
    assert len(reader.followed) == module.CONTROL.failures_before_rest


def test_a_profile_that_works_starts_the_failure_count_over(world):
    broken = EmulatorError("Instagram profile never loaded")
    reader, _ = world({"club0": broken, "club1": broken, "club3": broken, "club4": broken})

    # Two failures, a follow, two failures, a follow: the day's two follows are made.
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)


def test_unfollows_failing_in_a_row_end_the_visit(world):
    broken = EmulatorError("Instagram profile never loaded")
    reader, _ = world({f"club{n}": broken for n in range(20)})

    assert module.unfollow_due(object(), "utsg", 5) == FollowVisit(0, 0, False, failing=True)
    assert len(reader.unfollowed) == module.CONTROL.failures_before_rest


def test_follows_that_stop_sticking_pause_the_account_like_a_block(world):
    stuck = module.FollowNotConfirmed("Instagram never confirmed the follow")
    reader, marks = world({"club0": stuck, "club1": stuck, "club2": stuck})

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(0, 0, True)
    assert reader.followed == ["club0", "club1", "club2"]
    assert module.follows_due("utsg") is False


def test_one_follow_that_does_not_stick_is_not_a_block(world):
    stuck = module.FollowNotConfirmed("Instagram never confirmed the follow")
    reader, _ = world({"club0": stuck, "club1": stuck})

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)


def test_try_again_later_pauses_the_account_for_a_day(world):
    reader, _ = world({"club0": ActionBlocked("Instagram asked this account to try again later")})

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(0, 0, True)
    assert module.follows_due("utsg") is False
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(0, 0, True)
    assert reader.followed == ["club0"]


def test_follows_are_due_while_accounts_wait_and_the_day_allows(world, monkeypatch):
    world()
    assert module.follows_due("utsg") is True

    monkeypatch.setattr(module, "_allowance", lambda school_id: 0)
    assert module.follows_due("utsg") is False

    monkeypatch.setattr(module, "_allowance", lambda school_id: 2)
    monkeypatch.setattr(module.candidates, "approved", lambda school_id, limit: [])
    assert module.follows_due("utsg") is False


class _At:
    """``datetime`` whose ``now`` is today at the given local time."""

    def __init__(self, **time):
        self.moment = datetime.now().astimezone().replace(**time, second=0, microsecond=0)

    def now(self, tz=None):
        return self.moment

    def fromisoformat(self, text):
        return datetime.fromisoformat(text)

    def acted(self, column, **ago):
        """A row followed (or unfollowed) this long before now."""
        row = {"followed_at": None, "unfollowed_at": None}
        row[column] = (self.moment - timedelta(**ago)).isoformat()
        return row


def test_todays_follows_and_unfollows_count_against_the_daily_cap(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.instagram_follow.follows")
    clock = _At(hour=23)
    monkeypatch.setattr(module, "datetime", clock)
    fake_sb.set_response(
        data=[clock.acted("followed_at", hours=5)] * 60
        + [clock.acted("unfollowed_at", hours=3)] * 60
    )

    # Sixty follows and sixty unfollows today, none in the last hour.
    assert module._allowance(7) == module.CONTROL.follows_per_account_per_day - 120
    # Every follow made today counts, including one whose bell step failed after it.
    assert all(call.args[0] != "status" for call in fake_sb.eq.call_args_list)


def test_follows_in_the_last_hour_count_against_the_hourly_cap(fake_sb, patch_sb, monkeypatch):
    patch_sb("services.instagram_follow.follows")
    clock = _At(hour=23)
    monkeypatch.setattr(module, "datetime", clock)
    hourly = module.CONTROL.follows_per_account_per_hour
    fake_sb.set_response(
        data=[clock.acted("followed_at", minutes=20)] * (hourly - 3)
        + [clock.acted("unfollowed_at", minutes=50)] * 2
        + [clock.acted("followed_at", minutes=70)] * 5
    )

    # The hour has room for one more, though the day has plenty left.
    assert module._allowance(7) == 1


def test_just_after_midnight_the_hourly_cap_still_counts_the_hour_before(
    fake_sb, patch_sb, monkeypatch
):
    patch_sb("services.instagram_follow.follows")
    clock = _At(hour=0, minute=10)
    monkeypatch.setattr(module, "datetime", clock)
    hourly = module.CONTROL.follows_per_account_per_hour
    fake_sb.set_response(data=[clock.acted("followed_at", minutes=30)] * hourly)

    assert module._allowance(7) == 0


def test_accounts_already_followed_are_confirmed_without_using_the_allowance(world):
    already = FollowOutcome("Following", tapped=False)
    reader, marks = world({"club0": already, "club1": already, "club2": already})

    # Allowance 2: three confirmations, then two real follows.
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 3, False)
    assert marks[:3] == [("confirmed", "0"), ("confirmed", "1"), ("confirmed", "2")]
    assert marks[3:] == [("followed", "3"), ("followed", "4")]


def test_a_visit_stops_before_the_next_profile_when_the_worker_needs_the_emulator(world):
    already = FollowOutcome("Following", tapped=False)
    reader, marks = world({f"club{n}": already for n in range(20)})
    asked = []

    def stop():
        asked.append(len(reader.followed))
        return len(reader.followed) == 2

    assert module.follow_due(object(), "utsg", 5, stop=stop) == FollowVisit(0, 2, False)
    assert reader.followed == ["club0", "club1"]
    assert asked == [0, 1, 2]


def test_unfollows_stop_before_the_next_profile_when_the_worker_needs_the_emulator(world):
    reader, _ = world()
    visit = module.unfollow_due(object(), "utsg", 5, stop=lambda: len(reader.unfollowed) == 1)
    assert visit == FollowVisit(1, 0, False)
    assert reader.unfollowed == ["club0"]


def test_a_visit_opens_a_bounded_number_of_profiles(world):
    already = FollowOutcome("Following", tapped=False)
    reader, _ = world({f"club{n}": already for n in range(100)})

    visit = module.follow_due(object(), "utsg", 1)
    assert visit == FollowVisit(0, module.PROFILES_PER_FOLLOW, False)
    assert len(reader.followed) == module.PROFILES_PER_FOLLOW


def test_a_follow_whose_bell_failed_still_uses_the_allowance(world):
    no_bell = FollowedWithoutBell("Instagram never showed the bell")
    reader, marks = world({"club0": no_bell, "club1": no_bell})

    # Allowance 2: both taps count, so the visit stops instead of following more.
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)
    assert reader.followed == ["club0", "club1"]
    assert marks == [("followed without bell", "0"), ("followed without bell", "1")]


def test_try_again_later_after_a_follow_counts_it_and_stops(world):
    blocked = FollowedWithoutBell("Instagram asked this account to try again later")
    blocked.__cause__ = ActionBlocked("Instagram asked this account to try again later")
    reader, marks = world({"club0": blocked})

    assert module.follow_due(object(), "utsg", 5) == FollowVisit(1, 0, True)
    assert reader.followed == ["club0"]
    assert module.follows_due("utsg") is False


def test_a_visit_unfollows_within_the_allowance(world):
    reader, marks = world()

    assert module.unfollow_due(object(), "utsg", 5) == FollowVisit(2, 0, False)
    assert reader.unfollowed == ["club0", "club1"]
    assert marks == [("unfollowed", "0"), ("unfollowed", "1")]


def test_accounts_not_followed_or_gone_are_rejected_without_using_the_allowance(world):
    reader, marks = world({"club0": False, "club1": None})

    assert module.unfollow_due(object(), "utsg", 5) == FollowVisit(2, 2, False)
    assert marks == [("gone", "0"), ("gone", "1"), ("unfollowed", "2"), ("unfollowed", "3")]


def test_a_failed_unfollow_waits_for_the_next_try(world):
    reader, marks = world({"club0": EmulatorError("Instagram never confirmed the unfollow")})

    assert module.unfollow_due(object(), "utsg", 1) == FollowVisit(1, 0, False)
    assert marks == [("failed", "0"), ("unfollowed", "1")]


def test_try_again_later_stops_unfollows_and_follows(world):
    reader, _ = world({"club0": ActionBlocked("Instagram asked this account to try again later")})

    assert module.unfollow_due(object(), "utsg", 5) == FollowVisit(0, 0, True)
    assert module.unfollows_due("utsg") is False
    assert module.follows_due("utsg") is False
