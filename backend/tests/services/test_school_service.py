import pytest

from core.tables import SCHOOLS
from schemas.school import SchoolSummary
from services import school_service

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

    assert school_service.search_schools("mit.edu") == [
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

    assert school_service.search_schools("waterloo") == [
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

    assert school_service.search_schools("   ") == [
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
