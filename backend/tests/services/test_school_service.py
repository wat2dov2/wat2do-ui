import pytest

from core.tables import SCHOOLS
from schemas.school import SchoolSummary
from services import school_service


def test_season_projection_is_school_scoped_static_and_public(fake_sb, patch_sb, monkeypatch):
    from core.controlbox import CampusSeasonsControl

    configuration = CampusSeasonsControl.model_validate(
        {
            "definitions": {
                "homecoming": {
                    "labels": {"en": "HOCO", "fr": "Retrouvailles"},
                    "instructions": "Private base prompt",
                }
            },
            "schools": {
                "uwaterloo": {
                    "instructions": "Private school prompt",
                    "seasons": [
                        {
                            "id": "homecoming",
                            "instructions": "Private override",
                            "display_windows": [
                                {
                                    "start_date": "2026-09-20",
                                    "end_date": "2026-09-27",
                                    "source_url": "https://uwaterloo.ca/calendar",
                                },
                                {
                                    "start_date": "2027-09-20",
                                    "end_date": "2027-09-27",
                                    "source_url": "https://uwaterloo.ca/calendar",
                                },
                            ],
                        }
                    ],
                }
            },
        }
    )
    monkeypatch.setattr(
        school_service,
        "controlbox",
        school_service.controlbox.model_copy(
            update={
                "event_discovery": school_service.controlbox.event_discovery.model_copy(
                    update={"campus_seasons": configuration}
                )
            }
        ),
    )
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)
    schools = {school.slug: school for school in school_service.search_schools("")}
    expected = [
        {
            "id": "homecoming",
            "classification_id": "homecoming",
            "labels": {"en": "HOCO", "fr": "Retrouvailles"},
            "display_windows": [
                {"start_date": "2026-09-20", "end_date": "2026-09-27"},
                {"start_date": "2027-09-20", "end_date": "2027-09-27"},
            ],
        }
    ]
    assert schools["uwaterloo"].model_dump(mode="json")["event_seasons"] == expected
    assert schools["mit"].event_seasons == []
    assert school_service.campus_season_ids(" UWATERLOO ") == frozenset({"homecoming"})
    assert school_service.campus_season_ids("mit") == frozenset()

    fake_sb.set_response(data=[{**SCHOOL_ROWS[0], "id": 1}])
    for lookup, argument in [
        (school_service.get_school, "uwaterloo"),
        (school_service.get_school_by_name, "University of Waterloo"),
        (school_service.get_school_by_recipient_id, "12345"),
    ]:
        school = lookup(argument)
        assert school.model_dump(mode="json")["event_seasons"] == expected


SCHOOL_ROWS = [
    {
        "slug": "uwaterloo",
        "name": "University of Waterloo",
        "primary_color": "#FFD54F",
        "secondary_color": "#111111",
        "timezone": "America/Toronto",
        "school_email_domains": [{"domain": "uwaterloo.ca"}],
    },
    {
        "slug": "mit",
        "name": "Massachusetts Institute of Technology",
        "primary_color": "#A31F34",
        "secondary_color": "#FFFFFF",
        "timezone": "America/Toronto",
        "school_email_domains": [{"domain": "mit.edu"}],
    },
]


def test_search_schools_leads_with_the_primary_domain(fake_sb, patch_sb):
    """Consumers read the head of the list, so a subdomain must never lead."""
    patch_sb("services.school_service")
    fake_sb.set_response(
        data=[
            {
                "slug": "uwaterloo",
                "name": "University of Waterloo",
                "primary_color": "#FFD54F",
                "secondary_color": "#111111",
                "timezone": "America/Toronto",
                "faculties": ["Engineering", "Mathematics"],
                "location_examples": ["MC", "SLC"],
                "school_email_domains": [
                    {"domain": "edu.uwaterloo.ca", "is_primary": False},
                    {"domain": "uwaterloo.ca", "is_primary": True},
                ],
            }
        ]
    )

    [school] = school_service.search_schools("")

    assert school.email_domains == ["uwaterloo.ca", "edu.uwaterloo.ca"]
    assert school.timezone == "America/Toronto"
    assert school.faculties == ["Engineering", "Mathematics"]
    assert school.location_examples == ["MC", "SLC"]


def test_search_schools_matches_domain_fragment(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert [
        school.model_copy(update={"event_seasons": []})
        for school in school_service.search_schools("mit.edu")
    ] == [
        SchoolSummary(
            slug="mit",
            name="Massachusetts Institute of Technology",
            primary_color="#A31F34",
            secondary_color="#FFFFFF",
            timezone="America/Toronto",
            email_domains=["mit.edu"],
        )
    ]
    fake_sb.table.assert_called_once_with(SCHOOLS)


def test_search_schools_matches_display_name_fragment(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert [
        school.model_copy(update={"event_seasons": []})
        for school in school_service.search_schools("waterloo")
    ] == [
        SchoolSummary(
            slug="uwaterloo",
            name="University of Waterloo",
            primary_color="#FFD54F",
            secondary_color="#111111",
            timezone="America/Toronto",
            email_domains=["uwaterloo.ca"],
        )
    ]


def test_search_schools_returns_directory_for_blank_query(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert [
        school.model_copy(update={"event_seasons": []})
        for school in school_service.search_schools("   ")
    ] == [
        SchoolSummary(
            slug="mit",
            name="Massachusetts Institute of Technology",
            primary_color="#A31F34",
            secondary_color="#FFFFFF",
            timezone="America/Toronto",
            email_domains=["mit.edu"],
        ),
        SchoolSummary(
            slug="uwaterloo",
            name="University of Waterloo",
            primary_color="#FFD54F",
            secondary_color="#111111",
            timezone="America/Toronto",
            email_domains=["uwaterloo.ca"],
        ),
    ]


def test_get_school_by_recipient_id(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(
        data=[
            {
                "id": 1,
                "slug": "uwaterloo",
                "name": "University of Waterloo",
                "primary_color": "#FFD54F",
                "secondary_color": "#111111",
                "timezone": "America/Toronto",
                "recipient_id": "76214170483",
                "semester_start": "2026-05-01",
                "semester_end": "2026-08-31",
            }
        ]
    )

    school = school_service.get_school_by_recipient_id("76214170483")

    assert school is not None
    assert school.slug == "uwaterloo"
    fake_sb.eq.assert_called_once_with("recipient_id", "76214170483")


@pytest.mark.parametrize("recipient_id", ["0", "012345", "not-numeric"])
def test_get_school_by_recipient_id_rejects_noncanonical_values(
    recipient_id,
    fake_sb,
    patch_sb,
):
    patch_sb("services.school_service")

    assert school_service.get_school_by_recipient_id(recipient_id) is None
    fake_sb.table.assert_not_called()


@pytest.mark.parametrize(
    "query,expected",
    [
        ("UWATERLOO", ["uwaterloo"]),
        ("u waterloo", ["uwaterloo"]),
        ("u-waterloo", ["uwaterloo"]),
        ("waterloo.ca", ["uwaterloo"]),
        ("  University   of Waterloo ", ["uwaterloo"]),
        ("ＭＩＴ", ["mit"]),
        ("mit edu", ["mit"]),
        ("massachusetts", ["mit"]),
        ("MassachusettsInstituteofTechnology", ["mit"]),
        ("technology", ["mit"]),
        ("unknown university", []),
        ("", ["mit", "uwaterloo"]),
    ],
)
def test_search_schools_normalized_and_compact_terms(query, expected, fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    schools = school_service.search_schools(query)

    assert [school.slug for school in schools] == expected


@pytest.mark.parametrize("limit", [1, 2, 3])
def test_search_schools_ranks_exact_then_prefix_then_substring(limit, fake_sb, patch_sb):
    patch_sb("services.school_service")
    rows = [
        {**SCHOOL_ROWS[0], "slug": "abc", "name": "ABC University", "school_email_domains": []},
        {**SCHOOL_ROWS[0], "slug": "xabc", "name": "XABC University", "school_email_domains": []},
        {**SCHOOL_ROWS[0], "slug": "ab", "name": "AB University", "school_email_domains": []},
    ]
    fake_sb.set_response(data=rows)

    schools = school_service.search_schools("a b", limit)

    assert [school.slug for school in schools] == ["ab", "abc", "xabc"][:limit]


def test_holiday_windows_project_specific_filters_without_reclassifying_events():
    seasons = school_service._event_seasons("uwaterloo")
    holidays = {season.id: season for season in seasons if season.classification_id == "holidays"}
    assert set(holidays) == {"thanksgiving", "halloween", "winter_holidays"}
    assert "holidays" not in {season.id for season in seasons}
    assert holidays["thanksgiving"].labels["en"] == "Thanksgiving"
    assert holidays["halloween"].labels["en"] == "Halloween"
    assert str(holidays["thanksgiving"].display_windows[0].start_date) == "2026-09-28"
    assert str(holidays["halloween"].display_windows[0].start_date) == "2026-10-17"
    assert str(holidays["winter_holidays"].display_windows[0].start_date) == "2026-12-01"
    assert all(len(season.display_windows) == 1 for season in holidays.values())
    assert "holidays" in school_service.campus_season_ids("uwaterloo")
    assert "thanksgiving" not in school_service.campus_season_ids("uwaterloo")
