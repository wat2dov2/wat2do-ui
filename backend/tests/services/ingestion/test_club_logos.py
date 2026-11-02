import json

import pytest

from services.ingestion import club_logos as module

PICTURE = "https://scontent.cdninstagram.com/club.jpg"
LOGO = "https://wat2do.io/media/organization-logos/club.jpg"


@pytest.fixture
def stored(monkeypatch):
    """Profiles read, pictures uploaded and logos set, in order."""
    calls: dict[str, list] = {"read": [], "uploaded": [], "logos": []}
    pictures = {"ubcclub": PICTURE, "gone": None}

    def fetch_profile(handle, *, post_limit):
        calls["read"].append(handle)
        return {"read": "ok", "profile_picture_url": pictures[handle]}

    monkeypatch.setattr(module, "fetch_profile", fetch_profile)
    monkeypatch.setattr(
        module,
        "upload_image_from_url",
        lambda url, *, bucket: calls["uploaded"].append(url) or LOGO,
    )
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        lambda club_id, data: calls["logos"].append((club_id, data.logo_url)),
    )
    monkeypatch.setattr(module, "_clubs_without_logos", lambda: {"ubcclub": [7, 8], "gone": [9]})
    return calls


def test_a_profile_picture_becomes_the_logo_of_every_club_with_that_handle(stored, tmp_path):
    logos = module.ClubLogos(tmp_path / "club_logos.json")

    assert logos.fill_next() is True
    assert logos.fill_next() is True
    assert logos.fill_next() is False

    assert stored["read"] == ["ubcclub", "gone"]
    assert stored["uploaded"] == [PICTURE]
    # A handle with no picture (deleted, renamed, the default avatar) changes nothing.
    assert stored["logos"] == [(7, LOGO), (8, LOGO)]


def test_a_read_handle_waits_out_the_retry_days_even_after_a_restart(stored, tmp_path):
    state = tmp_path / "club_logos.json"
    first = module.ClubLogos(state)
    first.fill_next()
    first.fill_next()

    restarted = module.ClubLogos(state)
    assert restarted.fill_next() is False
    assert stored["read"] == ["ubcclub", "gone"]

    read_at = json.loads(state.read_text())
    stale = {
        handle: at - module.CONTROL.club_logo_retry_days * 86400 for handle, at in read_at.items()
    }
    state.write_text(json.dumps(stale))
    assert module.ClubLogos(state).fill_next() is True
