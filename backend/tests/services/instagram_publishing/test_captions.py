from types import SimpleNamespace

import pytest

from services.instagram_publishing.captions import build_caption, default_caption_intro


@pytest.fixture(autouse=True)
def school_language(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.get_school",
        lambda slug: SimpleNamespace(language="fr" if slug == "uqam" else "en"),
    )


def test_build_caption_uses_canonical_handle_time_location_and_cta(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda _school: "America/Toronto",
    )
    caption = build_caption(
        [
            {
                "title": "Midnight Breakfast",
                "club": "Student Society",
                "ig_handle": "verifiedclub",
                "dtstart_utc": "2026-07-24T23:30:00+00:00",
                "location": "Student Life Centre",
            }
        ],
        "utm",
    )

    assert "Midnight Breakfast - @verifiedclub" in caption
    assert "Fri, Jul 24 · 7:30 PM" in caption
    assert "Student Life Centre" in caption
    assert "Fresh events at utm" not in caption
    assert default_caption_intro("utm").startswith("Fresh events at utm")
    assert "University of Toronto Mississauga" not in caption
    assert "final, up-to-date" in caption
    assert "utm.wat2do.io" in caption
    assert "https://" not in caption


def test_build_caption_preserves_school_url_within_instagram_limit(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda _school: "America/Toronto",
    )
    event = {
        "title": "Long event title " * 20,
        "club": "Club " * 20,
        "ig_handle": None,
        "dtstart_utc": "2026-07-24T23:30:00+00:00",
        "location": "Very long location " * 20,
    }

    caption = build_caption([event] * 9, "uwaterloo")

    assert len(caption) <= 2200
    assert "uwaterloo.wat2do.io" in caption
    assert "https://" not in caption


def test_french_school_caption_uses_french_copy_and_local_time(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda school: "America/Toronto",
    )
    caption = build_caption([{"title": "Soirée", "dtstart_utc": "2026-09-09T23:30:00Z"}], "uqam")
    assert "Nouveaux événements" not in caption
    assert default_caption_intro("uqam").startswith("Nouveaux événements")
    assert "09/09/2026 · 19 h 30" in caption
    assert "uqam.wat2do.io" in caption


def test_intro_is_preserved_and_event_suffix_follows_order(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda _: "America/Toronto",
    )
    events = [
        {"title": title, "dtstart_utc": "2026-09-09T23:30:00Z"} for title in ["Second", "First"]
    ]
    suffix = build_caption(events, "utsg")
    assert (
        build_caption(events, "utsg", "Hello\nYour campus plans")
        == "Hello\nYour campus plans\n\n" + suffix
    )
    assert suffix.index("1. Second") < suffix.index("2. First")
    default = default_caption_intro("utsg")
    assert build_caption(events, "utsg", default) == default + "\n\n" + suffix
    assert "Fresh events" not in suffix


def test_oversized_intro_is_rejected(monkeypatch):
    monkeypatch.setattr(
        "services.instagram_publishing.captions.resolve_school_timezone",
        lambda _: "America/Toronto",
    )
    with pytest.raises(Exception, match="2200-character"):
        build_caption([], "utsg", "x" * 2200)
