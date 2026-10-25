from unittest.mock import MagicMock

import pytest

from services.notifications import submission_review


def _email(**overrides):
    defaults = {
        "kind": "club",
        "title": "Tea Club",
        "approved": True,
        "recipient": "lead@uwo.ca",
        "url": "https://uwo.wat2do.io/clubs/7",
        "rejection_reason": None,
    }
    return submission_review.build_review_decision_email(**{**defaults, **overrides})


def test_approval_comes_from_the_team_and_links_the_live_page():
    message = _email()

    assert message.sender == "wat2do <team@wat2do.io>"
    assert message.to == "lead@uwo.ca"
    assert message.subject == "Your club Tea Club is live on wat2do"
    assert 'href="https://uwo.wat2do.io/clubs/7"' in message.body_html
    assert "View your club: https://uwo.wat2do.io/clubs/7" in message.body_text


def test_rejection_quotes_the_escaped_reason_without_a_link():
    message = _email(
        kind="event", approved=False, rejection_reason="Not <b>a campus</b> event\nSorry"
    )

    assert message.subject == "We could not approve your event Tea Club"
    assert "Not &lt;b&gt;a campus&lt;/b&gt; event<br>Sorry" in message.body_html
    assert "Reason: Not <b>a campus</b> event\nSorry" in message.body_text
    assert 'href="https://uwo.wat2do.io' not in message.body_html


@pytest.mark.parametrize(
    ("recipient", "status"), [(None, "approved"), ("", "rejected"), ("lead@uwo.ca", "pending")]
)
def test_nothing_is_sent_without_a_recipient_or_a_decision(monkeypatch, recipient, status):
    send = MagicMock()
    monkeypatch.setattr(submission_review.email_service, "send_safely", send)

    submission_review.send_review_decision(
        kind="club",
        title="Tea Club",
        status=status,
        recipient=recipient,
        school="uwo",
        path="/clubs/7",
    )

    send.assert_not_called()


def test_decision_is_sent_with_the_school_url_and_trimmed_reason(monkeypatch):
    send = MagicMock()
    monkeypatch.setattr(submission_review.email_service, "send_safely", send)

    submission_review.send_review_decision(
        kind="position",
        title="Design Lead",
        status="rejected",
        recipient="lead@uwo.ca",
        school="uwo",
        path="/positions",
        rejection_reason="   ",
    )

    message = send.call_args.args[0]
    assert message.subject == "We could not approve your position Design Lead"
    assert "Reason" not in message.body_text
