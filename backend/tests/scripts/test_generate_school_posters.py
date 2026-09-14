from datetime import date

from schemas.school import SchoolRecord
from scripts.generate_school_posters import build_poster_data, resolve_recap_term


def _school() -> SchoolRecord:
    return SchoolRecord(
        id=35,
        slug="columbia",
        name="Columbia University",
        primary_color="#0056D6",
        secondary_color="#FFFFFF",
        timezone="America/New_York",
        semester_start=date(2026, 1, 12),
        semester_end=date(2026, 5, 1),
    )


def _club(
    club_id: int,
    name: str,
    *,
    ig: str | None = None,
) -> dict:
    return {
        "id": club_id,
        "club_name": name,
        "logo_url": f"https://assets.test/org-{club_id}.png",
        "ig": ig,
        "status": "approved",
    }


def _event(
    event_id: int,
    club_id: int,
    *,
    added_at: str,
    category: str,
    food: list[str] | None = None,
    cancelled: bool = False,
) -> dict:
    return {
        "id": event_id,
        "title": f"Event {event_id}",
        "description": "Campus event",
        "club": None,
        "club_id": club_id,
        "category": category,
        "food": food,
        "source_image_url": f"https://assets.test/event-{event_id}.png",
        "added_at": added_at,
        "cancelled": cancelled,
        "ig_handle": None,
    }


def _occurrence(event_id: int, start: str) -> dict:
    return {"id": f"occurrence-{event_id}-{start}", "event_id": event_id, "dtstart_utc": start}


def _build() -> dict:
    clubs = [
        _club(1, "Columbia Federalist", ig="https://instagram.com/columbia_federalist/"),
        _club(2, "Gourmand Columbia", ig="@gourmandcolumbia"),
        _club(3, "No Events Club"),
    ]
    events = [
        _event(
            11,
            1,
            added_at="2026-04-29T12:00:00Z",
            category="Politics & Advocacy",
            food=["Free Pizza", "Coffee"],
        ),
        _event(
            12,
            1,
            added_at="2026-01-01T12:00:00Z",
            category="Arts & Culture",
        ),
        _event(
            13,
            2,
            added_at="2026-04-01T12:00:00Z",
            category="Food & Drink",
            food=["Pizza", "Yes!"],
        ),
        _event(
            14,
            2,
            added_at="2026-04-20T12:00:00Z",
            category="Food & Drink",
            food=["Boba"],
            cancelled=True,
        ),
    ]
    occurrences = [
        _occurrence(11, "2026-04-29T16:00:00Z"),
        _occurrence(11, "2026-04-29T18:00:00Z"),
        _occurrence(12, "2026-04-30T16:00:00Z"),
        _occurrence(13, "2026-04-29T22:00:00Z"),
        _occurrence(14, "2026-04-29T20:00:00Z"),
    ]
    return build_poster_data(
        school=_school(),
        clubs=clubs,
        term_events=events,
        occurrences=occurrences,
        total_event_count=960,
        observed_club_count=3,
        background_images=["https://assets.test/event-11.png"],
        site_url="https://columbia.wat2do.io",
    )


def test_build_poster_data_uses_distinct_events_and_occurrences_for_the_right_metrics():
    payload = _build()

    assert payload["claims"] == {
        "observed_club_count": 3,
        "all_time_event_count": 960,
    }
    assert payload["recap"]["event_count"] == 3
    assert payload["recap"]["busiest_date"] == {
        "date": "2026-04-29",
        "label": "April 29",
        "count": 3,
    }
    assert payload["recap"]["heatmap"][-3:] == [
        {"date": "2026-04-29", "count": 3},
        {"date": "2026-04-30", "count": 1},
        {"date": "2026-05-01", "count": 0},
    ]


def test_build_poster_data_ranks_clubs_and_normalizes_food_from_structured_values():
    payload = _build()

    assert payload["recap"]["top_clubs"][:2] == [
        {
            "name": "Columbia Federalist",
            "handle": "columbia_federalist",
            "logo_url": "https://assets.test/org-1.png",
            "event_count": 2,
        },
        {
            "name": "Gourmand Columbia",
            "handle": "gourmandcolumbia",
            "logo_url": "https://assets.test/org-2.png",
            "event_count": 1,
        },
    ]
    assert payload["recap"]["food_linked_event_count"] == 2
    assert payload["recap"]["food_mentions"] == [
        {"label": "pizza", "count": 2},
        {"label": "coffee", "count": 1},
    ]


def test_build_poster_data_derives_awards_with_stable_semantics():
    payload = _build()
    awards = {award["title"]: award for award in payload["recap"]["awards"]}

    assert awards["Procrastinator Award"]["handle"] == "columbia_federalist"
    assert awards["Procrastinator Award"]["description"] == "Announced with 4 hours to spare."
    assert awards["Feed the Campus Award"]["handle"] == "columbia_federalist"
    assert awards["Feed the Campus Award"]["description"] == (
        "Hosted the most food-linked events (1)."
    )
    assert awards["Swiss Army Club"]["handle"] == "columbia_federalist"
    assert awards["Swiss Army Club"]["description"] == ("Showed up across 2 event categories.")
    assert awards["Early Planners Award"]["handle"] == "columbia_federalist"


def test_build_poster_data_converts_utc_occurrences_to_the_school_day():
    payload = build_poster_data(
        school=_school(),
        clubs=[_club(1, "Night Owls")],
        term_events=[
            _event(
                20,
                1,
                added_at="2026-04-28T00:00:00Z",
                category="Games & Recreation",
            )
        ],
        occurrences=[_occurrence(20, "2026-04-30T02:30:00Z")],
        total_event_count=1,
        observed_club_count=1,
        background_images=[],
        site_url="https://columbia.wat2do.io",
    )

    april_29 = next(day for day in payload["recap"]["heatmap"] if day["date"] == "2026-04-29")
    april_30 = next(day for day in payload["recap"]["heatmap"] if day["date"] == "2026-04-30")
    assert april_29["count"] == 1
    assert april_30["count"] == 0


def test_build_poster_data_uses_event_handles_for_legacy_organizers():
    legacy_event = _event(
        30,
        1,
        added_at="2026-04-01T12:00:00Z",
        category="Community & Service",
    )
    legacy_event.update(
        {
            "club_id": None,
            "club": "@columbiabso",
            "ig_handle": "@columbiabso",
        }
    )

    payload = build_poster_data(
        school=_school(),
        clubs=[],
        term_events=[legacy_event],
        occurrences=[_occurrence(30, "2026-04-10T16:00:00Z")],
        total_event_count=1,
        observed_club_count=1,
        background_images=[],
        site_url="https://columbia.wat2do.io",
    )

    assert payload["recap"]["top_clubs"] == [
        {
            "name": "columbiabso",
            "handle": "columbiabso",
            "logo_url": "https://assets.test/event-30.png",
            "event_count": 1,
        }
    ]


def test_resolve_recap_term_uses_active_season_when_school_has_advanced_to_fall():
    school = _school().model_copy(
        update={
            "semester_start": date(2026, 9, 8),
            "semester_end": date(2026, 12, 22),
        }
    )

    resolved = resolve_recap_term(school, as_of=date(2026, 8, 10))

    assert resolved.semester_start == date(2026, 5, 1)
    assert resolved.semester_end == date(2026, 8, 31)


def test_resolve_recap_term_preserves_school_dates_in_the_active_season():
    school = _school().model_copy(
        update={
            "semester_start": date(2026, 9, 9),
            "semester_end": date(2026, 12, 22),
        }
    )

    resolved = resolve_recap_term(school, as_of=date(2026, 10, 1))

    assert resolved.semester_start == date(2026, 9, 9)
    assert resolved.semester_end == date(2026, 12, 22)
