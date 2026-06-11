"""Tests for core.allowed_emails — school lookup + multi-@ rejection."""

import pytest

from core import allowed_emails
from core.allowed_emails import get_school_for_email, is_email_allowed


@pytest.fixture(autouse=True)
def _stub_domain_table(monkeypatch):
    """Replace the Supabase-backed domain table with a fixed in-memory dict.

    Mirrors the seeds in 20260610180000_add_schools_and_email_domains.sql so
    the tests don't reach out to a live database.
    """
    monkeypatch.setattr(
        allowed_emails,
        "ALLOWED_EMAIL_DOMAINS",
        {
            "uwaterloo.ca": "University of Waterloo",
            "edu.uwaterloo.ca": "University of Waterloo",
            "wlu.ca": "Wilfrid Laurier University",
            "utoronto.ca": "University of Toronto - St. George",
            "scar.utoronto.ca": "University of Toronto - Scarborough",
            "cornell.edu": "Cornell University",
            "nyu.edu": "New York University",
            "mit.edu": "Massachusetts Institute of Technology",
        },
    )
    monkeypatch.setattr(allowed_emails, "_loaded", True)


class TestGetSchoolForEmail:
    def test_standard_uwaterloo_email(self):
        assert get_school_for_email("alice@uwaterloo.ca") == "University of Waterloo"

    def test_case_insensitive(self):
        assert get_school_for_email("ALICE@UWATERLOO.CA") == "University of Waterloo"

    def test_strips_whitespace(self):
        assert get_school_for_email("  bob@wlu.ca  ") == "Wilfrid Laurier University"

    def test_unknown_domain_returns_none(self):
        assert get_school_for_email("evil@gmail.com") is None

    def test_empty_string_returns_none(self):
        assert get_school_for_email("") is None

    def test_none_input_returns_none(self):
        # The signature is typed as str, but the implementation guards
        # defensively; ensure that guard holds.
        assert get_school_for_email(None) is None  # type: ignore[arg-type]

    # ----- Multi-@ bypass attempts (A5 / allowed_emails) -----

    def test_rejects_email_with_two_at_signs(self):
        """a@b@uwaterloo.ca would naively pass with split('@')[-1] — reject."""
        assert get_school_for_email("a@b@uwaterloo.ca") is None

    def test_rejects_email_with_embedded_at_in_local(self):
        assert get_school_for_email("a@b@c@uwaterloo.ca") is None

    def test_rejects_empty_local_part(self):
        assert get_school_for_email("@uwaterloo.ca") is None

    def test_rejects_empty_domain_part(self):
        assert get_school_for_email("alice@") is None

    def test_no_at_sign_returns_none(self):
        assert get_school_for_email("alice.uwaterloo.ca") is None

    def test_resolves_each_seeded_school(self):
        assert get_school_for_email("a@cornell.edu") == "Cornell University"
        assert get_school_for_email("b@nyu.edu") == "New York University"
        assert get_school_for_email("c@mit.edu") == "Massachusetts Institute of Technology"

    def test_uoft_domain_routes_to_st_george(self):
        assert get_school_for_email("d@utoronto.ca") == "University of Toronto - St. George"

    def test_uoft_scarborough_subdomain(self):
        assert get_school_for_email("e@scar.utoronto.ca") == "University of Toronto - Scarborough"


class TestIsEmailAllowed:
    def test_allowed_school(self):
        assert is_email_allowed("student@uwaterloo.ca") is True

    def test_disallowed_domain(self):
        assert is_email_allowed("user@example.com") is False

    def test_multi_at_not_allowed(self):
        assert is_email_allowed("a@b@uwaterloo.ca") is False

    def test_seeded_domain_allowed(self):
        assert is_email_allowed("student@cornell.edu") is True


class TestLoadMetadataFromDatabase:
    def test_load_metadata_updates_constants(self, monkeypatch):
        """Verify that load_allowed_domains correctly queries and updates the constants."""
        # 1. Reset state
        monkeypatch.setattr(allowed_emails, "_loaded", False)

        from unittest.mock import MagicMock

        from core import allowed_emails as ae
        from core.constants.schools import (
            SCHOOL_ALIASES,
            SCHOOL_SEMESTER_ENDS,
            SCHOOL_TIMEZONES,
        )

        # Mock database client responses
        mock_schools_data = [
            {
                "name": "University of Waterloo",
                "timezone": "America/Toronto",
                "aliases": ["uw", "uwaterloo"],
                "semester_ends": ["20251231T235959Z", "20260430T235959Z", "20260831T235959Z"],
            },
            {
                "name": "Test University",
                "timezone": "America/New_York",
                "aliases": ["tu", "testu"],
                "semester_ends": ["20251231T000000Z", "20260430T000000Z", "20260831T000000Z"],
            },
        ]

        mock_domains_data = [
            {"domain": "uwaterloo.ca", "schools": {"name": "University of Waterloo"}},
            {"domain": "testu.edu", "schools": {"name": "Test University"}},
        ]

        # We construct a mock query chain
        mock_schools_res = MagicMock(data=mock_schools_data)
        mock_domains_res = MagicMock(data=mock_domains_data)

        mock_schools_chain = MagicMock()
        mock_schools_chain.select.return_value.execute.return_value = mock_schools_res

        mock_domains_chain = MagicMock()
        mock_domains_chain.select.return_value.execute.return_value = mock_domains_res

        mock_sb = MagicMock()
        def mock_table(table_name):
            if table_name == "schools":
                return mock_schools_chain
            elif table_name == "school_email_domains":
                return mock_domains_chain
            return MagicMock()

        mock_sb.table.side_effect = mock_table

        monkeypatch.setattr("core.database.get_sb", lambda: mock_sb)

        # 2. Run the load function
        ae.load_allowed_domains()

        # 3. Assertions
        assert ae.ALLOWED_EMAIL_DOMAINS["uwaterloo.ca"] == "University of Waterloo"
        assert ae.ALLOWED_EMAIL_DOMAINS["testu.edu"] == "Test University"

        assert SCHOOL_TIMEZONES["university of waterloo"] == "America/Toronto"
        assert SCHOOL_TIMEZONES["test university"] == "America/New_York"

        assert SCHOOL_ALIASES["uw"] == "university of waterloo"
        assert SCHOOL_ALIASES["tu"] == "test university"

        assert SCHOOL_SEMESTER_ENDS["university of waterloo"] == (
            "20251231T235959Z",
            "20260430T235959Z",
            "20260831T235959Z",
        )
        assert SCHOOL_SEMESTER_ENDS["test university"] == (
            "20251231T000000Z",
            "20260430T000000Z",
            "20260831T000000Z",
        )

