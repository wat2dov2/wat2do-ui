import subprocess
from types import SimpleNamespace

import httpx
import pytest

from services import school_service
from services.instagram_digest import sessions


def _session() -> sessions.InstagramSession:
    return sessions.InstagramSession(
        intended_recipient_id="12345",
        sessionid="12345%3Asecret-session",
        csrftoken="secret-csrf",
        ds_user_id="12345",
        user_agent="matching-browser-agent",
        account_username="ubc.wat2do.io",
        mid="secret-mid",
        ig_did="secret-device",
        rur="secret-region",
    )


def test_session_repr_does_not_contain_cookie_values():
    rendered = repr(_session())

    assert "12345" in rendered
    assert "secret" not in rendered


@pytest.mark.parametrize(
    ("recipient_id", "sessionid", "ds_user_id", "expected_status"),
    [
        ("0123", "0123:session", "0123", sessions.SessionHealthStatus.CONFIGURATION_ERROR),
        ("123", "456:session", "123", sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED),
        ("123", "123:session", "456", sessions.SessionHealthStatus.CONFIGURATION_ERROR),
    ],
)
def test_session_rejects_noncanonical_or_mismatched_identities(
    recipient_id,
    sessionid,
    ds_user_id,
    expected_status,
):
    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.InstagramSession(
            intended_recipient_id=recipient_id,
            sessionid=sessionid,
            csrftoken="csrf",
            ds_user_id=ds_user_id,
            user_agent="browser-agent",
        )

    assert raised.value.status is expected_status


def test_store_writes_secrets_only_through_bounded_interactive_stdin(monkeypatch):
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        if "find-generic-password" in args:
            return subprocess.CompletedProcess(args, 44, "", "not found")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(sessions.subprocess, "run", run)
    sessions.KeychainSessionStore().store(_session())

    assert len(calls) == 3
    write_args, write_kwargs = calls[0]
    assert write_args == ["/usr/bin/security", "-q", "-i"]
    assert " -a 12345 " in write_kwargs["input"]
    read_args, read_kwargs = calls[1]
    assert read_args == [
        "/usr/bin/security",
        "find-generic-password",
        "-a",
        "index-v1",
        "-s",
        "io.wat2do.instagram-digest",
        "-w",
    ]
    assert read_kwargs["input"] is None
    for args, _kwargs in calls:
        assert "secret" not in repr(args)
    for args, kwargs in (calls[0], calls[2]):
        assert args == ["/usr/bin/security", "-q", "-i"]
        assert len(kwargs["input"].encode("utf-8")) < 4096
        assert "secret" not in kwargs["input"]
    assert " -a index-v1 " in calls[2][1]["input"]
    assert all(call[1]["timeout"] == 30 for call in calls)


def test_keychain_timeout_is_sanitized(monkeypatch):
    def run(args, **kwargs):
        raise subprocess.TimeoutExpired(args, kwargs["timeout"], output="secret output")

    monkeypatch.setattr(sessions.subprocess, "run", run)

    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.KeychainSessionStore().load("12345")

    assert raised.value.status is sessions.SessionHealthStatus.TRANSIENT_ERROR
    assert "secret" not in str(raised.value)
    assert raised.value.__cause__ is None


def test_delete_repairs_index_before_idempotent_secret_removal(monkeypatch):
    index_payload = sessions._encode_index({"12345", "67890"})
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        if "find-generic-password" in args:
            return subprocess.CompletedProcess(args, 0, index_payload, "")
        if "delete-generic-password" in args:
            return subprocess.CompletedProcess(args, 44, "", "not found")
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(sessions.subprocess, "run", run)

    sessions.KeychainSessionStore().delete("12345")

    assert "find-generic-password" in calls[0][0]
    assert calls[1][0] == ["/usr/bin/security", "-q", "-i"]
    assert sessions._encode_index({"67890"}) in calls[1][1]["input"]
    assert "delete-generic-password" in calls[2][0]


def test_load_uses_fixed_argv_and_round_trips_all_cookies(monkeypatch):
    payload = sessions._encode_session(_session())
    calls = []

    def run(args, **kwargs):
        calls.append((args, kwargs))
        return subprocess.CompletedProcess(args, 0, f"{payload}\n", "")

    monkeypatch.setattr(sessions.subprocess, "run", run)
    loaded = sessions.KeychainSessionStore().load("12345")

    assert loaded.cookies == _session().cookies
    assert loaded.user_agent == "matching-browser-agent"
    assert loaded.account_username == "ubc.wat2do.io"
    assert calls[0][0] == [
        "/usr/bin/security",
        "find-generic-password",
        "-a",
        "12345",
        "-s",
        "io.wat2do.instagram-digest",
        "-w",
    ]
    assert calls[0][1]["input"] is None


def test_index_is_sorted_unique_and_lists_without_reading_session_items(monkeypatch):
    payload = sessions._encode_index({"67890", "12345"})
    calls = []

    def run(args, **kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, payload, "")

    monkeypatch.setattr(sessions.subprocess, "run", run)
    recipient_ids = sessions.KeychainSessionStore().list_recipient_ids()

    assert recipient_ids == ("12345", "67890")
    assert len(calls) == 1
    assert "index-v1" in calls[0]


def test_missing_session_has_stable_health_and_exit_category(monkeypatch):
    def run(args, **kwargs):
        return subprocess.CompletedProcess(args, 44, "", "private keychain detail")

    monkeypatch.setattr(sessions.subprocess, "run", run)
    health = sessions.KeychainSessionStore().local_health("12345")

    assert health == sessions.SessionHealth("12345", sessions.SessionHealthStatus.MISSING)


def test_invalid_keychain_payload_is_configuration_error_without_payload_leak(monkeypatch):
    def run(args, **kwargs):
        return subprocess.CompletedProcess(args, 0, "not-a-secret-payload", "")

    monkeypatch.setattr(sessions.subprocess, "run", run)

    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.KeychainSessionStore().load("12345")

    assert raised.value.status is sessions.SessionHealthStatus.CONFIGURATION_ERROR
    assert "not-a-secret-payload" not in str(raised.value)


def test_prime_browser_session_derives_identity_and_captures_rotating_cookies(monkeypatch):
    captured = {}

    class _Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.cookies = httpx.Cookies(kwargs["cookies"])
            self.cookies.set("csrftoken", "primed-csrf", domain=".instagram.com")
            self.cookies.set("mid", "primed-mid", domain=".instagram.com")

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url):
            captured["url"] = url
            return httpx.Response(
                200,
                json={"form_data": {"username": "UBC.Wat2Do.IO"}},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(sessions.httpx, "Client", _Client)
    primed = sessions.prime_browser_session(
        "12345%3Asecret-session",
        "matching-browser-agent",
        timeout_seconds=30,
    )

    assert primed.intended_recipient_id == "12345"
    assert primed.ds_user_id == "12345"
    assert primed.csrftoken == "primed-csrf"
    assert primed.mid == "primed-mid"
    assert primed.user_agent == "matching-browser-agent"
    assert primed.account_username == "ubc.wat2do.io"
    assert captured["url"] == ("https://www.instagram.com/api/v1/accounts/edit/web_form_data/")
    assert captured["follow_redirects"] is False
    assert {cookie.name: cookie.value for cookie in captured["cookies"].jar} == {
        "sessionid": "12345%3Asecret-session",
        "ds_user_id": "12345",
    }
    assert {cookie.domain for cookie in captured["cookies"].jar} == {".instagram.com"}


def test_instagram_cookie_jar_replaces_rotated_cookie_at_the_same_scope():
    jar = sessions.instagram_cookie_jar({"csrftoken": "old-token"})

    jar.set("csrftoken", "new-token", domain=".instagram.com", path="/")

    matching = [cookie for cookie in jar.jar if cookie.name == "csrftoken"]
    assert [(cookie.domain, cookie.path, cookie.value) for cookie in matching] == [
        (".instagram.com", "/", "new-token")
    ]


@pytest.mark.parametrize("status_code", [301, 302, 303, 307, 308])
def test_prime_browser_session_classifies_login_redirect_without_leaking_location(
    monkeypatch,
    status_code,
):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url):
            return httpx.Response(
                status_code,
                headers={"location": "/accounts/login/?secret=hidden"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(sessions.httpx, "Client", _Client)

    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.prime_browser_session(
            "12345:secret-session",
            "matching-browser-agent",
            timeout_seconds=30,
        )

    assert raised.value.status is sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED
    assert "hidden" not in str(raised.value)


def test_prime_browser_session_classifies_checkpoint_as_reauthorization(monkeypatch):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url):
            return httpx.Response(
                400,
                json={"message": "checkpoint_required"},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(sessions.httpx, "Client", _Client)

    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.prime_browser_session(
            "12345:secret-session",
            "matching-browser-agent",
            timeout_seconds=30,
        )

    assert raised.value.status is sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED


def test_prime_browser_session_requires_authenticated_cookie_after_check(monkeypatch):
    class _Client:
        def __init__(self, **kwargs):
            self.cookies = httpx.Cookies(kwargs["cookies"])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url):
            self.cookies.delete("sessionid")
            self.cookies.set("csrftoken", "primed-csrf", domain=".instagram.com")
            return httpx.Response(
                200,
                json={"form_data": {"username": "ubc.wat2do.io"}},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(sessions.httpx, "Client", _Client)

    with pytest.raises(sessions.SessionStoreError) as raised:
        sessions.prime_browser_session(
            "12345:secret-session",
            "matching-browser-agent",
            timeout_seconds=30,
        )

    assert raised.value.status is sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED


def test_refresh_browser_session_preserves_cookies_and_primes_existing_csrf(monkeypatch):
    captured = {}

    class _Client:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.cookies = httpx.Cookies(kwargs["cookies"])

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def get(self, url):
            return httpx.Response(
                200,
                json={"form_data": {"username": "renamed.wat2do.io"}},
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(sessions.httpx, "Client", _Client)
    refreshed = sessions.refresh_browser_session(_session(), timeout_seconds=30)

    assert refreshed.cookies == _session().cookies
    assert refreshed.account_username == "renamed.wat2do.io"
    assert captured["headers"]["X-CSRFToken"] == "secret-csrf"


def test_remote_audit_checks_every_routed_and_indexed_session_before_failing(monkeypatch):
    healthy = _session()
    reauthorization = sessions.InstagramSession(
        intended_recipient_id="67890",
        sessionid="67890:session",
        csrftoken="csrf",
        ds_user_id="67890",
        user_agent="browser-agent",
        account_username="tmu.wat2do.io",
    )

    class _Store:
        def __init__(self):
            self.stored = []

        def list_recipient_ids(self):
            return ("12345", "67890", "99999")

        def load(self, recipient_id):
            if recipient_id == "12345":
                return healthy
            if recipient_id == "67890":
                return reauthorization
            raise sessions.SessionStoreError(
                sessions.SessionHealthStatus.MISSING,
                "sanitized missing",
            )

        def store(self, session):
            self.stored.append(session.intended_recipient_id)

    schools = [
        SimpleNamespace(slug="ubc", recipient_id="12345"),
        SimpleNamespace(slug="tmu", recipient_id="67890"),
        SimpleNamespace(slug="dalhousie", recipient_id="22222"),
    ]
    refreshed = []

    def refresh(session, *, timeout_seconds):
        refreshed.append(session.intended_recipient_id)
        assert timeout_seconds == 30
        if session.intended_recipient_id == "67890":
            raise sessions.SessionStoreError(
                sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED,
                "secret upstream detail",
            )
        return session

    monkeypatch.setattr(
        school_service,
        "list_notification_routed_schools",
        lambda: schools,
    )
    monkeypatch.setattr(sessions, "refresh_browser_session", refresh)
    store = _Store()

    audit = sessions.audit_notification_sessions(store, timeout_seconds=30)

    assert audit.healthy is False
    assert refreshed == ["12345", "67890"]
    assert store.stored == ["12345"]
    checks = {check.intended_recipient_id: check for check in audit.sessions}
    assert checks["12345"].status is sessions.SessionHealthStatus.HEALTHY
    assert checks["67890"].status is sessions.SessionHealthStatus.REAUTHORIZATION_REQUIRED
    assert checks["67890"].issue is sessions.SessionHealthIssue.REMOTE_CHECK_FAILED
    assert checks["22222"].status is sessions.SessionHealthStatus.MISSING
    assert checks["22222"].issue is sessions.SessionHealthIssue.MISSING_SESSION
    assert checks["99999"].status is sessions.SessionHealthStatus.CONFIGURATION_ERROR
    assert checks["99999"].issue is sessions.SessionHealthIssue.ORPHAN_SESSION
    for check in audit.report_fields()["sessions"]:
        assert set(check) == {
            "school",
            "intended_recipient_id",
            "account_username",
            "status",
            "issue",
        }
        assert "secret" not in repr(check)


def test_remote_audit_reports_unindexed_session_as_configuration_error(monkeypatch):
    class _Store:
        def list_recipient_ids(self):
            return ()

        def load(self, _recipient_id):
            return _session()

    monkeypatch.setattr(
        school_service,
        "list_notification_routed_schools",
        lambda: [SimpleNamespace(slug="ubc", recipient_id="12345")],
    )

    audit = sessions.audit_notification_sessions(_Store(), timeout_seconds=30)

    assert audit.sessions == (
        sessions.RoutedSessionHealth(
            "ubc",
            "12345",
            "ubc.wat2do.io",
            sessions.SessionHealthStatus.CONFIGURATION_ERROR,
            sessions.SessionHealthIssue.UNINDEXED_SESSION,
        ),
    )


def test_remote_audit_continues_indexed_checks_when_routing_lookup_fails(monkeypatch):
    class _Store:
        def __init__(self):
            self.stored = []

        def list_recipient_ids(self):
            return ("12345",)

        def load(self, _recipient_id):
            return _session()

        def store(self, session):
            self.stored.append(session.intended_recipient_id)

    monkeypatch.setattr(
        school_service,
        "list_notification_routed_schools",
        lambda: (_ for _ in ()).throw(RuntimeError("database secret")),
    )
    monkeypatch.setattr(
        sessions,
        "refresh_browser_session",
        lambda session, **_kwargs: session,
    )
    store = _Store()

    audit = sessions.audit_notification_sessions(store, timeout_seconds=30)

    assert audit.healthy is False
    assert audit.issues == (sessions.SessionHealthIssue.ROUTING_LOOKUP_FAILED,)
    assert audit.sessions[0].status is sessions.SessionHealthStatus.HEALTHY
    assert store.stored == ["12345"]
