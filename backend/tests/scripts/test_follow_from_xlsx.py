from types import SimpleNamespace

import pytest

from scripts import follow_from_xlsx
from services.instagram_digest.sessions import InstagramSession


def _session(account_username: str = "ubc.wat2do.io") -> InstagramSession:
    return InstagramSession(
        intended_recipient_id="12345",
        sessionid="12345:secret-session",
        csrftoken="secret-csrf",
        ds_user_id="12345",
        user_agent="matching-browser-agent",
        account_username=account_username,
        mid="secret-mid",
    )


def test_prepare_session_uses_recipient_routing_and_keychain_only(monkeypatch):
    loaded = _session()
    stored = []

    class FakeStore:
        def load(self, recipient_id):
            assert recipient_id == "12345"
            return loaded

        def store(self, session):
            stored.append(session)

    monkeypatch.setattr(
        follow_from_xlsx.school_service,
        "get_school",
        lambda slug: SimpleNamespace(slug=slug, recipient_id="12345"),
    )
    monkeypatch.setattr(follow_from_xlsx, "KeychainSessionStore", FakeStore)
    monkeypatch.setattr(
        follow_from_xlsx,
        "refresh_browser_session",
        lambda session, *, timeout_seconds: session,
    )

    recipient_id, store = follow_from_xlsx.prepare_session("ubc.wat2do.io")

    assert isinstance(store, FakeStore)
    assert recipient_id == "12345"
    assert stored == [loaded]
    client = follow_from_xlsx.IgWebClient(loaded)
    assert client.http.headers["User-Agent"] == "matching-browser-agent"
    assert "sec-ch-ua" not in client.http.headers
    assert "sec-ch-ua-mobile" not in client.http.headers
    assert "sec-ch-ua-platform" not in client.http.headers
    assert client.http.cookies.get("sessionid", domain=".instagram.com") == ("12345:secret-session")
    assert client.session_snapshot().cookies == loaded.cookies


def test_prepare_session_rejects_a_keychain_session_for_another_account(monkeypatch):
    class FakeStore:
        def load(self, _recipient_id):
            return _session("different.wat2do.io")

        def store(self, _session):
            raise AssertionError("mismatched session must not be stored")

    monkeypatch.setattr(
        follow_from_xlsx.school_service,
        "get_school",
        lambda slug: SimpleNamespace(slug=slug, recipient_id="12345"),
    )
    monkeypatch.setattr(follow_from_xlsx, "KeychainSessionStore", FakeStore)
    monkeypatch.setattr(
        follow_from_xlsx,
        "refresh_browser_session",
        lambda session, *, timeout_seconds: session,
    )

    with pytest.raises(SystemExit, match="belongs to a different account"):
        follow_from_xlsx.prepare_session("ubc.wat2do.io")


def test_server_errors_are_classified_as_retryable():
    response = SimpleNamespace(
        status_code=572,
        headers={},
        json=lambda: {"message": "temporary edge failure"},
        text="temporary edge failure",
    )
    client = follow_from_xlsx.IgWebClient(_session())

    with pytest.raises(follow_from_xlsx.IgTransientError, match="HTTP 572"):
        client._check(response)
