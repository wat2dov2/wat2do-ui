"""Tests for core.allowed_emails — school lookup + multi-@ rejection."""

from core.allowed_emails import get_school_for_email, is_email_allowed


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


class TestIsEmailAllowed:
    def test_allowed_school(self):
        assert is_email_allowed("student@uwaterloo.ca") is True

    def test_disallowed_domain(self):
        assert is_email_allowed("user@example.com") is False

    def test_multi_at_not_allowed(self):
        assert is_email_allowed("a@b@uwaterloo.ca") is False
