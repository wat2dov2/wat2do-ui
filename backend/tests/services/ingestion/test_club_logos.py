import json

import pytest

from services.ingestion import club_logos as module

PICTURE = "https://scontent.cdninstagram.com/club.jpg"
LOGO = "https://wat2do.io/media/organization-logos/club.jpg"


@pytest.fixture
def stored(monkeypatch):
    """Profiles read, pictures uploaded and club updates applied, in order."""
    calls: dict[str, list] = {"read": [], "uploaded": [], "updates": []}
    profiles = {
        "ubcclub": {"read": "ok", "name": "UBC Club", "profile_picture_url": PICTURE},
        "gone": {"read": "not_found", "name": None, "profile_picture_url": None},
    }

    def fetch_profile(handle, *, post_limit):
        calls["read"].append(handle)
        return profiles[handle]

    monkeypatch.setattr(module, "fetch_profile", fetch_profile)
    monkeypatch.setattr(
        module,
        "upload_image_from_url",
        lambda url, *, bucket: calls["uploaded"].append(url) or LOGO,
    )
    monkeypatch.setattr(
        module.club_service,
        "update_club",
        lambda club_id, data: calls["updates"].append((club_id, data.logo_url, data.club_name)),
    )
    monkeypatch.setattr(
        module,
        "_clubs_needing_profile",
        lambda: {
            "ubcclub": [
                {"id": 7, "club_name": "UBC Club", "logo_url": None},  # real name, needs a logo
                {"id": 8, "club_name": "@ubcclub", "logo_url": "x"},  # has a logo, needs its name
            ],
            "gone": [{"id": 9, "club_name": "@gone", "logo_url": None}],  # dead account
        },
    )
    return calls


def test_profile_fills_the_logo_and_replaces_a_placeholder_name(stored, tmp_path):
    logos = module.ClubLogos(tmp_path / "club_logos.json")

    assert logos.fill_next() is True
    assert logos.fill_next() is True
    assert logos.fill_next() is False

    assert stored["read"] == ["ubcclub", "gone"]
    # Uploaded once, for the one club in the batch that lacked a logo.
    assert stored["uploaded"] == [PICTURE]
    # Club 7 gets the logo; club 8 keeps its logo but gets its real name; the dead
    # account (no name, no picture) changes nothing.
    assert stored["updates"] == [(7, LOGO, None), (8, None, "UBC Club")]


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
