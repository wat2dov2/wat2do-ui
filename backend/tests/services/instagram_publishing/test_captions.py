from services.instagram_publishing.captions import build_caption


def test_build_caption_uses_canonical_handle_time_location_and_cta():
    caption = build_caption(
        [
            {
                "title": "Midnight Breakfast",
                "organization": "Student Society",
                "ig_handle": "verifiedclub",
                "dtstart_utc": "2026-07-24T23:30:00+00:00",
                "location": "Student Life Centre",
            }
        ],
        "uwaterloo",
    )

    assert "Midnight Breakfast - @verifiedclub" in caption
    assert "Fri, Jul 24 · 7:30 PM" in caption
    assert "Student Life Centre" in caption
    assert "final, up-to-date" in caption
    assert "wat2do.io" in caption


def test_build_caption_never_exceeds_instagram_limit():
    event = {
        "title": "Long event title " * 20,
        "organization": "Organization " * 20,
        "ig_handle": None,
        "dtstart_utc": "2026-07-24T23:30:00+00:00",
        "location": "Very long location " * 20,
    }

    caption = build_caption([event] * 9, "uwaterloo")

    assert len(caption) <= 2200
