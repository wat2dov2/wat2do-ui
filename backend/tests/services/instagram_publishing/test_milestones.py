import io
import random
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from PIL import Image

from services.instagram_emulator.device import EmulatorError
from services.instagram_publishing import milestones
from services.instagram_publishing.milestones import Milestone, Post, Reading, Standing

RECORD = Post("1", "https://www.instagram.com/p/AAA/", 9)
NEWER = Post("2", "https://www.instagram.com/p/BBB/", 14)
NOW = datetime(2026, 11, 26, 15, tzinfo=timezone.utc)
YESTERDAY = NOW - timedelta(hours=24)
STATS_RUN = NOW - timedelta(hours=4)


def _reading(followers, *posts, captured_at=STATS_RUN):
    return Reading(followers, posts, captured_at)


def _standing(followers, seen, record=9, media_id="1", celebrated=("1",), at=YESTERDAY):
    return Standing(followers, seen, record, media_id, frozenset(celebrated), at)


def test_a_first_check_counts_what_the_account_has_as_celebrated():
    reading = _reading(358, NEWER, RECORD)
    standing = milestones.seed(reading, NOW)
    assert standing == Standing(300, 358, 14, "2", frozenset({"2"}), NOW)
    assert milestones.check(standing, reading, NOW + timedelta(hours=24))[0] == []


def test_a_new_account_starts_from_nothing():
    assert milestones.seed(_reading(42), NOW) == Standing(0, 42, 0, None, frozenset(), NOW)


@pytest.mark.parametrize(
    ("seen", "followers", "expected"),
    [
        (190, 199, []),
        (195, 200, [Milestone("followers", 200)]),
        (199, 217, [Milestone("followers", 200)]),
        # A jump over two hundreds celebrates only the newest.
        (180, 312, [Milestone("followers", 300)]),
        # Already at or over the hundred last time: nothing new happened.
        (205, 230, []),
    ],
)
def test_a_hundred_counts_only_when_this_check_sees_it_crossed(seen, followers, expected):
    due, after = milestones.check(_standing(100, seen), _reading(followers, RECORD), NOW)
    assert due == expected
    assert after.followers_seen == followers and after.checked_at == NOW


def test_a_dip_and_recovery_never_celebrates_the_same_hundred_again():
    standing = _standing(100, 195)
    due, standing = milestones.check(standing, _reading(201, RECORD), NOW)
    assert due == [Milestone("followers", 200)]
    standing = milestones.celebrated(standing, due[0])
    later = NOW
    for followers in (196, 203, 198, 200):
        later += timedelta(hours=24)
        due, standing = milestones.check(
            standing, _reading(followers, RECORD, captured_at=later), later
        )
        assert due == []
    assert standing.followers == 200


def test_a_crossing_found_late_is_only_recorded():
    standing = _standing(100, 190, at=NOW - timedelta(days=3))
    due, after = milestones.check(standing, _reading(204, NEWER, RECORD), NOW)
    assert due == []
    # The numbers move on, so the next check never sees that crossing again.
    assert (after.followers_seen, after.like_record, after.record_media_id) == (204, 14, "2")
    assert after.followers == 100 and after.celebrated == frozenset({"1"})


def test_a_stale_stats_run_is_no_new_reading():
    standing = _standing(100, 190)
    old = _reading(204, captured_at=NOW - timedelta(days=4))
    assert milestones.check(standing, old, NOW) == ([], standing)


def test_a_post_beating_the_record_is_due_once():
    standing = _standing(100, 120)
    due, after = milestones.check(standing, _reading(120, NEWER, RECORD), NOW)
    assert due == [Milestone("likes", 14, NEWER)]
    assert (after.like_record, after.record_media_id) == (14, "2")
    after = milestones.celebrated(after, due[0])
    assert after.celebrated == frozenset({"1", "2"})
    # The record post gaining more likes raises the record without another story.
    grown = Post("2", NEWER.permalink, 20)
    due, after = milestones.check(after, _reading(120, grown, RECORD), NOW)
    assert due == [] and after.like_record == 20


def test_an_earlier_record_post_taking_it_back_gets_no_second_story():
    standing = _standing(100, 120, record=14, media_id="2", celebrated=("1", "2"))
    back = Post("1", RECORD.permalink, 15)
    due, after = milestones.check(standing, _reading(120, NEWER, back), NOW)
    assert due == [] and (after.like_record, after.record_media_id) == (15, "1")


def test_a_record_under_the_minimum_is_kept_without_a_story(monkeypatch):
    monkeypatch.setattr(
        milestones,
        "CONTROL",
        SimpleNamespace(milestone_minimum_likes=10, milestone_window_hours=28),
    )
    small = Post("3", "https://www.instagram.com/p/CCC/", 7)
    due, after = milestones.check(_standing(0, 50, record=4), _reading(50, small), NOW)
    assert due == [] and after.like_record == 7
    # Once it beats the record at the minimum or more, the same post gets its story.
    big = Post("3", small.permalink, 11)
    assert milestones.check(after, _reading(50, big), NOW)[0] == [Milestone("likes", 11, big)]


@pytest.mark.parametrize("language", ["en", "fr"])
def test_the_thanks_are_plain_and_name_the_count(language):
    for kind in ("followers", "likes"):
        for text in milestones.THANKS[kind][language]:
            assert "\u2014" not in text and text == text.lower() and text.isprintable()
    text = milestones.thanks(Milestone("followers", 500), language, random.Random(1))
    assert "500" in text
    assert ("abonnés" in text) == (language == "fr")


def test_the_story_card_is_a_full_story_with_the_screenshot():
    shot = io.BytesIO()
    Image.new("RGB", (1080, 2200), (250, 250, 250)).save(shot, format="PNG")
    card = milestones.story_card(shot.getvalue(), "we just hit 500 followers. thank you all")
    with Image.open(io.BytesIO(card)) as image:
        assert image.size == (1080, 1920)
        assert image.getpixel((10, 10)) == (0, 82, 255)
        assert image.getpixel((540, 1500)) == (250, 250, 250)


class _Table:
    def __init__(self, database, name):
        self.database = database
        self.name = name

    def __getattr__(self, _name):
        return lambda *args, **kwargs: self

    def insert(self, row):
        self.database.tables[self.name].append(dict(row))
        return self

    def update(self, row):
        for stored in self.database.tables[self.name]:
            stored.update(row)
        return self

    def execute(self):
        return SimpleNamespace(data=[dict(row) for row in self.database.tables[self.name]])


def _standing_row(followers, seen, record, media_id, at=YESTERDAY):
    return {
        "account_key": "tmu",
        "followers_celebrated": followers,
        "followers_seen": seen,
        "like_record": record,
        "like_record_media_id": media_id,
        "celebrated_media_ids": [media_id],
        "checked_at": at.isoformat(),
        "open_followers": None,
        "open_media_id": None,
    }


@pytest.fixture
def database(monkeypatch):
    db = SimpleNamespace(
        tables={
            "instagram_publishing_accounts": [{"account_key": "tmu"}],
            # Newest first, as the query orders them.
            "instagram_account_snapshots": [
                {
                    "captured_on": "2026-11-26",
                    "followers_count": 205,
                    "captured_at": STATS_RUN.isoformat(),
                },
                {"captured_on": "2026-11-25", "followers_count": 190, "captured_at": ""},
            ],
            "instagram_account_media": [
                {"media_id": "2", "permalink": NEWER.permalink, "like_count": 14},
                {"media_id": "1", "permalink": RECORD.permalink, "like_count": 9},
                {
                    "media_id": "0",
                    "permalink": "https://www.instagram.com/p/OLD/",
                    "like_count": None,
                },
            ],
            "instagram_account_milestones": [],
        }
    )
    monkeypatch.setattr(
        milestones, "get_sb", lambda: SimpleNamespace(table=lambda name: _Table(db, name))
    )
    return db


class _Device:
    def __init__(self, free=5000):
        self.free = free
        self.resets = []

    def free_data_megabytes(self):
        return self.free

    def reset_app(self, user):
        self.resets.append(user)


def _png():
    out = io.BytesIO()
    Image.new("RGB", (1080, 2000), (255, 255, 255)).save(out, format="PNG")
    return out.getvalue()


@pytest.fixture
def emulator(monkeypatch):
    shared = []

    def share_photo(device, user, photo, *, before_post):
        before_post()
        shared.append(user)

    monkeypatch.setattr(milestones, "profile_screenshot", lambda device, user, name: _png())
    monkeypatch.setattr(milestones, "post_screenshot", lambda device, user, url: _png())
    monkeypatch.setattr(milestones, "share_photo", share_photo)
    return shared


def _post(device, milestone, now=NOW + timedelta(minutes=5)):
    return milestones.post_story(
        device,
        school_id=12,
        user=10,
        username="wat2do.tmu",
        language="en",
        milestone=milestone,
        now=now,
    )


FOLLOWERS_200 = Milestone("followers", 200)
LIKES_NEWER = Milestone("likes", 0, Post("", NEWER.permalink, 0))


def test_a_first_check_only_records_where_the_account_stands(database, emulator):
    report = milestones.report(12, NOW)
    assert report["first_check"] and report["open"] == []
    assert report["followers_history"] == [
        {"day": "2026-11-25", "followers": 190},
        {"day": "2026-11-26", "followers": 205},
    ]
    assert database.tables["instagram_account_milestones"] == [
        {**_standing_row(200, 205, 14, "2", at=NOW)}
    ]
    for milestone in (FOLLOWERS_200, LIKES_NEWER):
        with pytest.raises(milestones.MilestoneError, match="not open"):
            _post(_Device(), milestone)
    assert emulator == []


def test_the_report_opens_what_the_account_just_reached_and_each_gets_one_story(database, emulator):
    database.tables["instagram_account_milestones"].append(_standing_row(100, 190, 9, "1"))
    report = milestones.report(12, NOW)
    assert report["open"] == [{"followers": 200}, {"likes": 14, "post": NEWER.permalink}]
    assert report["highest_followers_celebrated"] == 100 and report["like_record"] == 14
    assert _post(_Device(), FOLLOWERS_200)["status"] == "posted to the story"
    assert _post(_Device(), LIKES_NEWER)["count"] == 14
    assert emulator == [10, 10]
    stored = database.tables["instagram_account_milestones"][0]
    assert (stored["followers_celebrated"], stored["open_followers"]) == (200, None)
    assert stored["celebrated_media_ids"] == ["1", "2"] and stored["open_media_id"] is None
    # Posted once: never again, whatever the sitting asks or the next check sees.
    for milestone in (FOLLOWERS_200, LIKES_NEWER):
        with pytest.raises(milestones.MilestoneError, match="not open"):
            _post(_Device(), milestone)
    assert milestones.report(12, NOW + timedelta(hours=24))["open"] == []


def test_only_the_open_hundred_and_post_can_get_a_story(database, emulator):
    database.tables["instagram_account_milestones"].append(_standing_row(100, 190, 9, "1"))
    milestones.report(12, NOW)
    with pytest.raises(milestones.MilestoneError, match="300 followers is not open"):
        _post(_Device(), Milestone("followers", 300))
    with pytest.raises(milestones.MilestoneError, match="That post is not open"):
        _post(_Device(), Milestone("likes", 0, Post("", RECORD.permalink, 0)))
    assert emulator == []


def test_a_story_from_an_earlier_sitting_check_is_refused(database, emulator):
    database.tables["instagram_account_milestones"].append(_standing_row(100, 190, 9, "1"))
    milestones.report(12, NOW)
    with pytest.raises(milestones.MilestoneError, match="Run ig milestones first"):
        _post(_Device(), FOLLOWERS_200, now=NOW + timedelta(hours=5))


def test_a_story_that_failed_before_posting_can_be_tried_again(database, emulator, monkeypatch):
    database.tables["instagram_account_milestones"].append(_standing_row(100, 190, 14, "2"))
    milestones.report(12, NOW)

    def broken(device, user, photo, *, before_post):
        raise EmulatorError("Instagram's story editor did not open")

    monkeypatch.setattr(milestones, "share_photo", broken)
    device = _Device()
    with pytest.raises(EmulatorError, match="did not open"):
        _post(device, FOLLOWERS_200)
    assert device.resets == [10]
    assert database.tables["instagram_account_milestones"][0]["open_followers"] == 200
    monkeypatch.setattr(milestones, "share_photo", lambda d, u, p, *, before_post: before_post())
    assert _post(_Device(), FOLLOWERS_200)["status"] == "posted to the story"


def test_a_story_waits_while_the_emulator_is_low_on_storage(database, emulator):
    database.tables["instagram_account_milestones"].append(_standing_row(100, 190, 14, "2"))
    milestones.report(12, NOW)
    with pytest.raises(milestones.MilestoneError, match="low on storage"):
        _post(_Device(free=10), FOLLOWERS_200)
    assert emulator == []


def test_an_account_without_stats_has_nothing_open(database, emulator):
    database.tables["instagram_publishing_accounts"].clear()
    assert milestones.report(12, NOW)["open"] == []
    with pytest.raises(milestones.MilestoneError, match="Run ig milestones first"):
        _post(_Device(), FOLLOWERS_200)
