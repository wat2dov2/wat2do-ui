import pytest

from services.instagram_accounts import (
    BrowserEngagementUncertain,
    BrowserSessionError,
    school_account_username,
)


def test_school_accounts_are_named_after_their_school():
    assert school_account_username("ubc") == "wat2do.ubc"
    assert school_account_username("UofT_SG") == "wat2do.uoft_sg"


@pytest.mark.parametrize("slug", ["", "has space", "a-dash", "x" * 30])
def test_a_slug_that_cannot_name_an_account_is_refused(slug):
    with pytest.raises(ValueError, match="account username is invalid"):
        school_account_username(slug)


def test_an_uncertain_action_is_a_session_failure():
    assert issubclass(BrowserEngagementUncertain, BrowserSessionError)
