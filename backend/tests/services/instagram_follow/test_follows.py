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
        "mark_follow_failed",
        lambda candidate_id, error, tapped=False: marks.append(
            ("followed without bell" if tapped else "failed", candidate_id)
        ),
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
    assert marks == [("failed", "0"), ("failed", "1"), ("followed", "2"), ("followed", "3")]


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


def test_todays_follows_count_against_the_daily_cap(fake_sb, patch_sb):
    patch_sb("services.instagram_follow.follows")
    fake_sb.set_response(data=[], count=18)

    assert module._allowance(7) == module.CONTROL.follows_per_account_per_day - 18
    # Every follow made today counts, including one whose bell step failed after it.
    assert all(call.args[0] != "status" for call in fake_sb.eq.call_args_list)


def test_accounts_already_followed_are_confirmed_without_using_the_allowance(world):
    already = FollowOutcome("Following", tapped=False)
    reader, marks = world({"club0": already, "club1": already, "club2": already})

    # Allowance 2: three confirmations, then two real follows.
    assert module.follow_due(object(), "utsg", 5) == FollowVisit(2, 3, False)
    assert marks[:3] == [("confirmed", "0"), ("confirmed", "1"), ("confirmed", "2")]
    assert marks[3:] == [("followed", "3"), ("followed", "4")]


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
