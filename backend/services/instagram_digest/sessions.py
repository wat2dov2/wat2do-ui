"""Local macOS Keychain storage for Instagram digest sessions."""

from __future__ import annotations

import base64
import fcntl
import json
import math
import os
import re
import subprocess
import time
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any
from urllib.parse import unquote

import httpx

from core.controlbox import controlbox
from schemas.school import SchoolRecord, validate_recipient_id

KEYCHAIN_SERVICE = "io.wat2do.instagram-digest"
_INDEX_ACCOUNT = "index-v1"
_SECURITY_PATH = "/usr/bin/security"
_KEYCHAIN_ITEM_VERSION = 1
_MAX_INTERACTIVE_COMMAND_BYTES = 4096
_MISSING_ITEM_EXIT_CODE = 44
_KEYCHAIN_INDEX_LOCK_PATH = "/tmp/wat2do-instagram-digest-keychain.lock"
_RECIPIENT_LOCK_PATH_PREFIX = "/tmp/wat2do-instagram-digest-session-"
_WEB_LOGIN_CHECK_URL = "https://www.instagram.com/api/v1/accounts/edit/web_form_data/"
_INSTAGRAM_USERNAME = re.compile(r"[a-z0-9._]{1,30}")


class SessionHealthStatus(StrEnum):
    """Stable categories safe to expose in logs and alerts."""

    HEALTHY = "healthy"
    MISSING = "missing"
    REAUTHORIZATION_REQUIRED = "reauthorization_required"
    TRANSIENT_ERROR = "transient_error"
    CONFIGURATION_ERROR = "configuration_error"


class SessionHealthIssue(StrEnum):
    AUDIT_FAILED = "audit_failed"
    ROUTING_LOOKUP_FAILED = "routing_lookup_failed"
    KEYCHAIN_INDEX_INVALID = "keychain_index_invalid"
    INVALID_ROUTING = "invalid_routing"
    DUPLICATE_ROUTING = "duplicate_routing"
    MISSING_SESSION = "missing_session"
    UNINDEXED_SESSION = "unindexed_session"
    ORPHAN_SESSION = "orphan_session"
    INVALID_SESSION = "invalid_session"
    REMOTE_CHECK_FAILED = "remote_check_failed"
    PERSISTENCE_FAILED = "persistence_failed"


class SessionStoreError(RuntimeError):
    """A sanitized Keychain or session-validation failure."""

    def __init__(self, status: SessionHealthStatus, message: str):
        super().__init__(message)
        self.status = status


@dataclass(frozen=True)
class InstagramSession:
    """Cookies for exactly one intended Instagram notification recipient."""

    intended_recipient_id: str
    sessionid: str = field(repr=False)
    csrftoken: str = field(repr=False)
    ds_user_id: str = field(repr=False)
    user_agent: str = field(repr=False)
    account_username: str | None = None
    mid: str | None = field(default=None, repr=False)
    ig_did: str | None = field(default=None, repr=False)
    rur: str | None = field(default=None, repr=False)

    def __post_init__(self) -> None:
        recipient_id = _validate_recipient_id(self.intended_recipient_id)
        ds_user_id = _validate_recipient_id(self.ds_user_id)
        if ds_user_id != recipient_id:
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram session identity does not match its intended recipient",
            )

        session_user_id = unquote(self.sessionid).split(":", 1)[0]
        if session_user_id != recipient_id:
            raise SessionStoreError(
                SessionHealthStatus.REAUTHORIZATION_REQUIRED,
                "Instagram session identity does not match its intended recipient",
            )
        if not self.csrftoken.strip():
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram session is missing its CSRF token",
            )
        if not self.user_agent.strip():
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram session is missing its browser user agent",
            )
        if self.account_username is not None and not _INSTAGRAM_USERNAME.fullmatch(
            self.account_username
        ):
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram account username is invalid",
            )

    @property
    def cookies(self) -> dict[str, str]:
        cookies = {
            "sessionid": self.sessionid,
            "csrftoken": self.csrftoken,
            "ds_user_id": self.ds_user_id,
        }
        for name in ("mid", "ig_did", "rur"):
            value = getattr(self, name)
            if value:
                cookies[name] = value
        return cookies


@dataclass(frozen=True)
class SessionHealth:
    intended_recipient_id: str
    status: SessionHealthStatus
    account_username: str | None = None


@dataclass(frozen=True)
class RoutedSessionHealth:
    school: str | None
    intended_recipient_id: str
    account_username: str | None
    status: SessionHealthStatus
    issue: SessionHealthIssue | None

    def report_fields(self) -> dict[str, str | None]:
        """Return the explicit safe-field allowlist used by workflow reports."""
        return {
            "school": self.school,
            "intended_recipient_id": self.intended_recipient_id,
            "account_username": self.account_username,
            "status": self.status.value,
            "issue": self.issue.value if self.issue else None,
        }


@dataclass(frozen=True)
class SessionHealthAudit:
    healthy: bool
    issues: tuple[SessionHealthIssue, ...]
    sessions: tuple[RoutedSessionHealth, ...]

    def report_fields(self) -> dict[str, Any]:
        """Return a JSON-ready report containing no session material."""
        return {
            "healthy": self.healthy,
            "issues": [issue.value for issue in self.issues],
            "sessions": [session.report_fields() for session in self.sessions],
        }


class KeychainSessionStore:
    """Store one compact Keychain generic-password item per recipient."""

    def load(self, intended_recipient_id: str) -> InstagramSession:
        recipient_id = _validate_recipient_id(intended_recipient_id)
        payload = self._read_password(recipient_id)
        return _session_from_payload(payload, expected_recipient_id=recipient_id)

    def store(self, session: InstagramSession) -> None:
        with _exclusive_keychain_index():
            self._write_password(
                session.intended_recipient_id,
                _encode_session(session),
            )
            recipient_ids = set(self.list_recipient_ids())
            if session.intended_recipient_id not in recipient_ids:
                recipient_ids.add(session.intended_recipient_id)
                self._write_password(_INDEX_ACCOUNT, _encode_index(recipient_ids))

    def delete(self, intended_recipient_id: str) -> None:
        recipient_id = _validate_recipient_id(intended_recipient_id)
        with _exclusive_keychain_index():
            recipient_ids = set(self.list_recipient_ids())
            if recipient_id in recipient_ids:
                recipient_ids.remove(recipient_id)
                self._write_password(_INDEX_ACCOUNT, _encode_index(recipient_ids))
            self._delete_password(recipient_id)

    def list_recipient_ids(self) -> tuple[str, ...]:
        try:
            payload = self._read_password(_INDEX_ACCOUNT)
        except SessionStoreError as exc:
            if exc.status is SessionHealthStatus.MISSING:
                return ()
            raise
        return _recipient_ids_from_payload(payload)

    def local_health(self, intended_recipient_id: str) -> SessionHealth:
        recipient_id = _validate_recipient_id(intended_recipient_id)
        try:
            session = self.load(recipient_id)
        except SessionStoreError as exc:
            return SessionHealth(recipient_id, exc.status)
        return SessionHealth(
            recipient_id,
            SessionHealthStatus.HEALTHY,
            session.account_username,
        )

    def all_local_health(self) -> tuple[SessionHealth, ...]:
        return tuple(self.local_health(recipient_id) for recipient_id in self.list_recipient_ids())

    def _read_password(self, account: str) -> str:
        result = _run_security(
            [
                _SECURITY_PATH,
                "find-generic-password",
                "-a",
                account,
                "-s",
                KEYCHAIN_SERVICE,
                "-w",
            ]
        )
        if result.returncode == _MISSING_ITEM_EXIT_CODE:
            raise SessionStoreError(
                SessionHealthStatus.MISSING,
                "Instagram session is not present in the local Keychain",
            )
        if result.returncode != 0:
            raise SessionStoreError(
                SessionHealthStatus.TRANSIENT_ERROR,
                "The local Keychain could not be read",
            )
        payload = result.stdout.strip()
        if not payload:
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "The local Keychain item is empty",
            )
        return payload

    def _write_password(self, account: str, payload: str) -> None:
        command = f"add-generic-password -U -a {account} -s {KEYCHAIN_SERVICE} -w {payload}\n"
        if len(command.encode("utf-8")) >= _MAX_INTERACTIVE_COMMAND_BYTES:
            raise SessionStoreError(
                SessionHealthStatus.CONFIGURATION_ERROR,
                "Instagram session is too large for the Keychain import command",
            )
        result = _run_security([_SECURITY_PATH, "-q", "-i"], input_text=command)
        if result.returncode != 0:
            raise SessionStoreError(
                SessionHealthStatus.TRANSIENT_ERROR,
                "The local Keychain could not be updated",
            )

    def _delete_password(self, account: str) -> None:
        result = _run_security(
            [
                _SECURITY_PATH,
                "delete-generic-password",
                "-a",
                account,
                "-s",
                KEYCHAIN_SERVICE,
            ]
        )
        if result.returncode == _MISSING_ITEM_EXIT_CODE:
            return
        if result.returncode != 0:
            raise SessionStoreError(
                SessionHealthStatus.TRANSIENT_ERROR,
                "The local Keychain could not be updated",
            )


def _run_security(
    args: list[str],
    *,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            args,
            input=input_text,
            capture_output=True,
            text=True,
            check=False,
            timeout=controlbox.instagram_digest.keychain_operation_timeout_seconds,
        )
    except subprocess.TimeoutExpired:
        raise SessionStoreError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "The local Keychain operation timed out",
        ) from None
    except OSError:
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "The macOS security command is unavailable",
        ) from None


@contextmanager
def _exclusive_keychain_index() -> Iterator[None]:
    """Serialize the recipient-index read, modify, and write sequence."""
    with _exclusive_file_lock(
        _KEYCHAIN_INDEX_LOCK_PATH,
        unavailable_message="The local Keychain index lock is unavailable",
        timeout_message="The local Keychain index lock timed out",
    ):
        yield


@contextmanager
def recipient_session_transaction(intended_recipient_id: str) -> Iterator[None]:
    """Serialize each recipient's complete load, remote use, and persistence cycle."""
    recipient_id = _validate_recipient_id(intended_recipient_id)
    with _exclusive_file_lock(
        f"{_RECIPIENT_LOCK_PATH_PREFIX}{recipient_id}.lock",
        unavailable_message="The local Instagram session lock is unavailable",
        timeout_message="The local Instagram session lock timed out",
    ):
        yield


@contextmanager
def _exclusive_file_lock(
    path: str,
    *,
    unavailable_message: str,
    timeout_message: str,
) -> Iterator[None]:
    timeout_seconds = controlbox.instagram_digest.keychain_operation_timeout_seconds
    try:
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_CLOEXEC", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600)
    except OSError:
        raise SessionStoreError(
            SessionHealthStatus.TRANSIENT_ERROR,
            unavailable_message,
        ) from None

    acquired = False
    try:
        try:
            os.fchmod(descriptor, 0o600)
        except OSError:
            raise SessionStoreError(
                SessionHealthStatus.TRANSIENT_ERROR,
                unavailable_message,
            ) from None
        deadline = time.monotonic() + timeout_seconds
        while not acquired:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except BlockingIOError:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise SessionStoreError(
                        SessionHealthStatus.TRANSIENT_ERROR,
                        timeout_message,
                    ) from None
                time.sleep(min(0.05, remaining))
        yield
    finally:
        if acquired:
            try:
                fcntl.flock(descriptor, fcntl.LOCK_UN)
            except OSError:
                pass
        try:
            os.close(descriptor)
        except OSError:
            pass


def _encode_session(session: InstagramSession) -> str:
    payload = {
        "v": _KEYCHAIN_ITEM_VERSION,
        "recipient": session.intended_recipient_id,
        "account_username": session.account_username,
        "user_agent": session.user_agent,
        "cookies": session.cookies,
    }
    return _encode_payload(payload)


def _session_from_payload(payload: str, *, expected_recipient_id: str) -> InstagramSession:
    decoded = _decode_payload(payload)
    if decoded.get("v") != _KEYCHAIN_ITEM_VERSION:
        raise _invalid_item()
    if decoded.get("recipient") != expected_recipient_id:
        raise SessionStoreError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram session identity does not match its Keychain account",
        )
    cookies = decoded.get("cookies")
    user_agent = decoded.get("user_agent")
    account_username = decoded.get("account_username")
    if not isinstance(cookies, dict) or not isinstance(user_agent, str):
        raise _invalid_item()
    if account_username is not None and not isinstance(account_username, str):
        raise _invalid_item()
    required = {name: cookies.get(name) for name in ("sessionid", "csrftoken", "ds_user_id")}
    if any(not isinstance(value, str) or not value for value in required.values()):
        raise _invalid_item()
    optional: dict[str, str | None] = {}
    for name in ("mid", "ig_did", "rur"):
        value = cookies.get(name)
        if value is not None and not isinstance(value, str):
            raise _invalid_item()
        optional[name] = value
    return InstagramSession(
        intended_recipient_id=expected_recipient_id,
        sessionid=required["sessionid"],
        csrftoken=required["csrftoken"],
        ds_user_id=required["ds_user_id"],
        user_agent=user_agent,
        account_username=account_username,
        **optional,
    )


def prime_browser_session(
    sessionid: str,
    user_agent: str,
    *,
    timeout_seconds: float,
) -> InstagramSession:
    """Validate a browser session and capture its recipient, CSRF, and account data."""
    recipient_id = recipient_id_from_sessionid(sessionid)
    return _prime_browser_session(
        recipient_id,
        user_agent,
        cookies={"sessionid": sessionid, "ds_user_id": recipient_id},
        timeout_seconds=timeout_seconds,
    )


def refresh_browser_session(
    session: InstagramSession,
    *,
    timeout_seconds: float,
) -> InstagramSession:
    """Health-check a stored session while preserving and rotating its cookies."""
    return _prime_browser_session(
        session.intended_recipient_id,
        session.user_agent,
        cookies=session.cookies,
        timeout_seconds=timeout_seconds,
    )


def instagram_cookie_jar(cookies: Mapping[str, str]) -> httpx.Cookies:
    """Seed Instagram cookies at their shared domain so rotations replace them."""
    jar = httpx.Cookies()
    for name, value in cookies.items():
        jar.set(name, value, domain=".instagram.com", path="/")
    return jar


def audit_notification_sessions(
    store: KeychainSessionStore,
    *,
    timeout_seconds: float,
) -> SessionHealthAudit:
    """Check every routed school and indexed session before reporting failure."""
    from services import school_service

    global_issues: list[SessionHealthIssue] = []
    checks: list[RoutedSessionHealth] = []

    routing_available = True
    try:
        routed_schools = school_service.list_notification_routed_schools()
    except Exception:
        routed_schools = []
        routing_available = False
        global_issues.append(SessionHealthIssue.ROUTING_LOOKUP_FAILED)

    index_available = True
    try:
        indexed_recipient_ids = set(store.list_recipient_ids())
    except Exception:
        indexed_recipient_ids = set()
        index_available = False
        global_issues.append(SessionHealthIssue.KEYCHAIN_INDEX_INVALID)

    routes_by_recipient_id: dict[str, list[SchoolRecord]] = {}
    for school in routed_schools:
        recipient_id = school.recipient_id or ""
        try:
            recipient_id = _validate_recipient_id(recipient_id)
        except SessionStoreError:
            checks.append(
                RoutedSessionHealth(
                    school=school.slug,
                    intended_recipient_id=recipient_id,
                    account_username=None,
                    status=SessionHealthStatus.CONFIGURATION_ERROR,
                    issue=SessionHealthIssue.INVALID_ROUTING,
                )
            )
            continue
        routes_by_recipient_id.setdefault(recipient_id, []).append(school)

    recipient_ids = sorted(set(routes_by_recipient_id) | indexed_recipient_ids)
    for recipient_id in recipient_ids:
        routes = routes_by_recipient_id.get(recipient_id, [])
        if len(routes) > 1:
            checks.extend(
                RoutedSessionHealth(
                    school=school.slug,
                    intended_recipient_id=recipient_id,
                    account_username=None,
                    status=SessionHealthStatus.CONFIGURATION_ERROR,
                    issue=SessionHealthIssue.DUPLICATE_ROUTING,
                )
                for school in routes
            )
            continue

        school_slug = routes[0].slug if routes else None
        if routing_available and not routes:
            checks.append(
                RoutedSessionHealth(
                    school=None,
                    intended_recipient_id=recipient_id,
                    account_username=_load_account_username(store, recipient_id),
                    status=SessionHealthStatus.CONFIGURATION_ERROR,
                    issue=SessionHealthIssue.ORPHAN_SESSION,
                )
            )
            continue

        if index_available and recipient_id not in indexed_recipient_ids:
            checks.append(_unindexed_or_missing_check(store, school_slug, recipient_id))
            continue

        checks.append(
            _remote_session_check(
                store,
                school_slug,
                recipient_id,
                timeout_seconds=timeout_seconds,
            )
        )

    checks.sort(key=lambda check: (check.intended_recipient_id, check.school or ""))
    healthy = not global_issues and all(
        check.status is SessionHealthStatus.HEALTHY for check in checks
    )
    return SessionHealthAudit(healthy, tuple(global_issues), tuple(checks))


def _load_account_username(
    store: KeychainSessionStore,
    recipient_id: str,
) -> str | None:
    try:
        return store.load(recipient_id).account_username
    except Exception:
        return None


def _unindexed_or_missing_check(
    store: KeychainSessionStore,
    school: str | None,
    recipient_id: str,
) -> RoutedSessionHealth:
    try:
        session = store.load(recipient_id)
    except SessionStoreError as exc:
        issue = (
            SessionHealthIssue.MISSING_SESSION
            if exc.status is SessionHealthStatus.MISSING
            else SessionHealthIssue.INVALID_SESSION
        )
        return RoutedSessionHealth(school, recipient_id, None, exc.status, issue)
    except Exception:
        return RoutedSessionHealth(
            school,
            recipient_id,
            None,
            SessionHealthStatus.CONFIGURATION_ERROR,
            SessionHealthIssue.INVALID_SESSION,
        )
    return RoutedSessionHealth(
        school,
        recipient_id,
        session.account_username,
        SessionHealthStatus.CONFIGURATION_ERROR,
        SessionHealthIssue.UNINDEXED_SESSION,
    )


def _remote_session_check(
    store: KeychainSessionStore,
    school: str | None,
    recipient_id: str,
    *,
    timeout_seconds: float,
) -> RoutedSessionHealth:
    try:
        with recipient_session_transaction(recipient_id):
            return _remote_session_check_locked(
                store,
                school,
                recipient_id,
                timeout_seconds=timeout_seconds,
            )
    except SessionStoreError as exc:
        return RoutedSessionHealth(
            school,
            recipient_id,
            None,
            exc.status,
            SessionHealthIssue.PERSISTENCE_FAILED,
        )
    except Exception:
        return RoutedSessionHealth(
            school,
            recipient_id,
            None,
            SessionHealthStatus.CONFIGURATION_ERROR,
            SessionHealthIssue.PERSISTENCE_FAILED,
        )


def _remote_session_check_locked(
    store: KeychainSessionStore,
    school: str | None,
    recipient_id: str,
    *,
    timeout_seconds: float,
) -> RoutedSessionHealth:
    try:
        session = store.load(recipient_id)
    except SessionStoreError as exc:
        issue = (
            SessionHealthIssue.MISSING_SESSION
            if exc.status is SessionHealthStatus.MISSING
            else SessionHealthIssue.INVALID_SESSION
        )
        return RoutedSessionHealth(school, recipient_id, None, exc.status, issue)
    except Exception:
        return RoutedSessionHealth(
            school,
            recipient_id,
            None,
            SessionHealthStatus.CONFIGURATION_ERROR,
            SessionHealthIssue.INVALID_SESSION,
        )

    try:
        refreshed = refresh_browser_session(session, timeout_seconds=timeout_seconds)
    except SessionStoreError as exc:
        return RoutedSessionHealth(
            school,
            recipient_id,
            session.account_username,
            exc.status,
            SessionHealthIssue.REMOTE_CHECK_FAILED,
        )
    except Exception:
        return RoutedSessionHealth(
            school,
            recipient_id,
            session.account_username,
            SessionHealthStatus.CONFIGURATION_ERROR,
            SessionHealthIssue.REMOTE_CHECK_FAILED,
        )

    try:
        store.store(refreshed)
    except SessionStoreError as exc:
        return RoutedSessionHealth(
            school,
            recipient_id,
            refreshed.account_username,
            exc.status,
            SessionHealthIssue.PERSISTENCE_FAILED,
        )
    except Exception:
        return RoutedSessionHealth(
            school,
            recipient_id,
            refreshed.account_username,
            SessionHealthStatus.CONFIGURATION_ERROR,
            SessionHealthIssue.PERSISTENCE_FAILED,
        )
    return RoutedSessionHealth(
        school,
        recipient_id,
        refreshed.account_username,
        SessionHealthStatus.HEALTHY,
        None,
    )


def _prime_browser_session(
    recipient_id: str,
    user_agent: str,
    *,
    cookies: dict[str, str],
    timeout_seconds: float,
) -> InstagramSession:
    browser_user_agent = user_agent.strip()
    if not browser_user_agent:
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram browser user agent cannot be empty",
        )
    if not math.isfinite(timeout_seconds) or timeout_seconds <= 0:
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram session-check timeout must be positive",
        )
    headers = {
        "User-Agent": browser_user_agent,
        "Accept": "*/*",
        "X-IG-App-ID": controlbox.instagram_digest.web_app_id,
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.instagram.com/",
        "Origin": "https://www.instagram.com",
        "X-ASBD-ID": "129477",
        "X-IG-WWW-Claim": "0",
    }
    if cookies.get("csrftoken"):
        headers["X-CSRFToken"] = cookies["csrftoken"]
    try:
        with httpx.Client(
            timeout=timeout_seconds,
            follow_redirects=False,
            headers=headers,
            cookies=instagram_cookie_jar(cookies),
        ) as client:
            response = client.get(_WEB_LOGIN_CHECK_URL)
            cookies = {cookie.name: cookie.value for cookie in client.cookies.jar}
    except httpx.TimeoutException as exc:
        raise SessionStoreError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram session check timed out",
        ) from exc
    except httpx.TransportError as exc:
        raise SessionStoreError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram session check could not reach Instagram",
        ) from exc

    payload = _login_check_payload(response)
    form_data = payload.get("form_data")
    username = form_data.get("username") if isinstance(form_data, dict) else None
    if not isinstance(username, str):
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram session check did not identify an account",
        )
    account_username = username.strip().lower()
    sessionid = cookies.get("sessionid")
    if not sessionid:
        raise SessionStoreError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram session check no longer has an authenticated session",
        )
    csrftoken = cookies.get("csrftoken")
    if not csrftoken:
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram session check did not provide a CSRF token",
        )
    return InstagramSession(
        intended_recipient_id=recipient_id,
        sessionid=sessionid,
        csrftoken=csrftoken,
        ds_user_id=recipient_id,
        user_agent=browser_user_agent,
        account_username=account_username,
        mid=cookies.get("mid"),
        ig_did=cookies.get("ig_did"),
        rur=cookies.get("rur"),
    )


def recipient_id_from_sessionid(sessionid: str) -> str:
    """Derive and validate Instagram's numeric user ID without exposing the cookie."""
    return _validate_recipient_id(unquote(sessionid).split(":", 1)[0])


def _login_check_payload(response: httpx.Response) -> dict[str, Any]:
    location = response.headers.get("location", "")
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    message = payload.get("message") if isinstance(payload, dict) else None
    auth_marker = message.lower() if isinstance(message, str) else ""
    if (
        response.status_code in {301, 302, 303, 307, 308, 401, 403}
        or any(marker in auth_marker for marker in ("login_required", "challenge", "checkpoint"))
        or any(marker in location for marker in ("/accounts/login", "/challenge/"))
    ):
        raise SessionStoreError(
            SessionHealthStatus.REAUTHORIZATION_REQUIRED,
            "Instagram browser session requires human reauthorization",
        )
    if response.status_code == 429 or response.status_code >= 500:
        raise SessionStoreError(
            SessionHealthStatus.TRANSIENT_ERROR,
            "Instagram session check is temporarily unavailable",
        )
    if response.is_error or not isinstance(payload, dict):
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram session check was rejected",
        )
    return payload


def _encode_index(recipient_ids: set[str]) -> str:
    return _encode_payload(
        {
            "v": _KEYCHAIN_ITEM_VERSION,
            "recipients": sorted(recipient_ids),
        }
    )


def _recipient_ids_from_payload(payload: str) -> tuple[str, ...]:
    decoded = _decode_payload(payload)
    recipient_ids = decoded.get("recipients")
    if decoded.get("v") != _KEYCHAIN_ITEM_VERSION or not isinstance(recipient_ids, list):
        raise _invalid_item()
    try:
        validated = tuple(_validate_recipient_id(value) for value in recipient_ids)
    except (SessionStoreError, TypeError):
        raise _invalid_item() from None
    if list(validated) != sorted(set(validated)):
        raise _invalid_item()
    return validated


def _encode_payload(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_payload(payload: str) -> dict[str, Any]:
    try:
        raw = base64.b64decode(payload, altchars=b"-_", validate=True)
        decoded = json.loads(raw)
    except (ValueError, json.JSONDecodeError):
        raise _invalid_item() from None
    if not isinstance(decoded, dict):
        raise _invalid_item()
    return decoded


def _validate_recipient_id(value: Any) -> str:
    try:
        return validate_recipient_id(value)
    except ValueError:
        raise SessionStoreError(
            SessionHealthStatus.CONFIGURATION_ERROR,
            "Instagram intended recipient ID is not canonical",
        ) from None


def _invalid_item() -> SessionStoreError:
    return SessionStoreError(
        SessionHealthStatus.CONFIGURATION_ERROR,
        "The local Instagram Keychain item is invalid",
    )
