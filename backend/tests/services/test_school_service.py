from core.tables import SCHOOLS
from schemas.school import SchoolSummary
from services import school_service

SCHOOL_ROWS = [
    {
        "slug": "uwaterloo",
        "name": "University of Waterloo",
        "school_email_domains": [{"domain": "uwaterloo.ca"}],
    },
    {
        "slug": "mit",
        "name": "Massachusetts Institute of Technology",
        "school_email_domains": [{"domain": "mit.edu"}],
    },
]


def test_search_schools_matches_domain_fragment(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert school_service.search_schools("mit.edu") == [
        SchoolSummary(slug="mit", name="Massachusetts Institute of Technology")
    ]
    fake_sb.table.assert_called_once_with(SCHOOLS)


def test_search_schools_matches_display_name_fragment(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert school_service.search_schools("waterloo") == [
        SchoolSummary(slug="uwaterloo", name="University of Waterloo")
    ]


def test_search_schools_returns_directory_for_blank_query(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(data=SCHOOL_ROWS)

    assert school_service.search_schools("   ") == [
        SchoolSummary(slug="mit", name="Massachusetts Institute of Technology"),
        SchoolSummary(slug="uwaterloo", name="University of Waterloo"),
    ]


def test_get_school_by_recipient_id(fake_sb, patch_sb):
    patch_sb("services.school_service")
    fake_sb.set_response(
        data=[
            {
                "slug": "uwaterloo",
                "name": "University of Waterloo",
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
