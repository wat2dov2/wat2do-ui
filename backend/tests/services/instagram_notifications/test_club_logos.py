import pytest

from services.instagram_notifications import club_logos as module
from services.instagram_notifications.browser_queue import BrowserJobQueue

RECIPIENT_ID = "12342599092"
SCHOOL = {"slug": "ubc", "recipient_id": RECIPIENT_ID}
PICTURE = "https://s.cdninstagram.com/club.jpg"


@pytest.fixture
def queue(tmp_path):
    return BrowserJobQueue(tmp_path / "state")


def _limits(monkeypatch, **values):
    monkeypatch.setattr(module, "_CONTROL", module._CONTROL.model_copy(update=values))


def _waiting(*handles):
    return {handle: [{"id": index + 1, "school": SCHOOL}] for index, handle in enumerate(handles)}


@pytest.mark.parametrize(
    "value,expected",
    [
        ("@UBC.Club", "ubc.club"),
        ("https://www.instagram.com/ubcclub/?hl=en", "ubcclub"),
        ("https://facebook.com/ubcclub", None),
        ("not a handle", None),
        (None, None),
    ],
)
def test_club_instagram_values_become_bare_handles(value, expected):
    assert module.instagram_handle(value) == expected


def test_a_retrieved_picture_becomes_every_matching_clubs_logo_once(queue, monkeypatch):
    clubs = {"ubcclub": [{"id": 7, "school": SCHOOL}, {"id": 8, "school": SCHOOL}]}
    monkeypatch.setattr(module, "_clubs_without_logos", lambda: clubs)
    uploads, updates = [], []
    monkeypatch.setattr(
        module,
        "upload_image_from_url",
        lambda url, *, bucket: uploads.append(url) or "https://wat2do.io/logo.jpg",
    )
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        lambda club_id, data: updates.append((club_id, data.logo_url)) or True,
    )
    _limits(monkeypatch, club_logo_daily_limit=0)
    queue.enqueue_retrieval(
        school="ubc",
        recipient_id=RECIPIENT_ID,
        account_username="wat2do.ubc",
        url="https://www.instagram.com/ubcclub/",
    )
    queue.finish(
        queue.claim_next(),
        result={"target_url": "https://www.instagram.com/ubcclub/", "profile_picture_url": PICTURE},
    )

    assert module.sync_club_logos(queue) == {"stored": 2, "queued": 0}
    queue.set_setting("club_logo_checked_at", 0)
    assert module.sync_club_logos(queue) == {"stored": 0, "queued": 0}
    assert uploads == [PICTURE]
    assert updates == [(7, "https://wat2do.io/logo.jpg"), (8, "https://wat2do.io/logo.jpg")]


def test_profiles_are_queued_a_few_at_a_time_on_an_interval(queue, monkeypatch):
    monkeypatch.setattr(module, "_clubs_without_logos", lambda: _waiting("one", "two", "three"))
    _limits(monkeypatch, club_logo_pending_limit=2)

    assert module.sync_club_logos(queue)["queued"] == 2
    # Too soon: nothing is read or queued until the interval passes.
    assert module.sync_club_logos(queue)["queued"] == 0
    queue.set_setting("club_logo_checked_at", 0)
    # Both reads are still waiting, so there is no room yet.
    assert module.sync_club_logos(queue)["queued"] == 0

    queue.finish(queue.claim_next(), result={"target_url": "https://www.instagram.com/one/"})
    queue.set_setting("club_logo_checked_at", 0)
    assert module.sync_club_logos(queue)["queued"] == 1


def test_the_daily_cap_and_retry_wait_hold_back_profiles(queue, monkeypatch):
    monkeypatch.setattr(module, "_clubs_without_logos", lambda: _waiting("one", "two"))
    _limits(monkeypatch, club_logo_pending_limit=10)
    _limits(monkeypatch, club_logo_daily_limit=1)

    assert module.sync_club_logos(queue)["queued"] == 1
    queue.set_setting("club_logo_checked_at", 0)
    assert module.sync_club_logos(queue)["queued"] == 0

    _limits(monkeypatch, club_logo_daily_limit=10)
    queue.set_setting("club_logo_checked_at", 0)
    # "one" was read today, so only "two" is left until the retry wait passes.
    assert module.sync_club_logos(queue)["queued"] == 1


def test_a_failed_read_is_retried_after_a_day_not_the_full_wait(queue, monkeypatch):
    monkeypatch.setattr(module, "_clubs_without_logos", lambda: _waiting("one"))

    assert module.sync_club_logos(queue)["queued"] == 1
    queue.finish(queue.claim_next(), error="Brave browser automation timed out")
    queue.set_setting("club_logo_checked_at", 0)
    assert module.sync_club_logos(queue)["queued"] == 0

    attempted = queue.get_setting("club_logo_attempted:one")
    queue.set_setting("club_logo_attempted:one", attempted - 86400)
    queue.set_setting("club_logo_checked_at", 0)
    assert module.sync_club_logos(queue)["queued"] == 1
