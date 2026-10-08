"""Pinned Brave tabs shared by one worker, with serialized account switches.

Credentials remain in Brave. Account verification returns only a username and a
boolean recipient match; no cookies cross the browser boundary.
"""

from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from collections.abc import Callable
from typing import Any, cast
from urllib.parse import urlsplit

from core.controlbox import controlbox
from schemas.school import validate_recipient_id

_CONTROL = controlbox.instagram_browser
_REQUEST_KEY = "__wat2doInstagramBrowserRequest"
_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_WAT2DO_ACCOUNT_PATTERN = re.compile(
    r"^(?:wat2do[.][a-z0-9_]+|[a-z0-9._]+[.]wat2do[.]io|(?:[a-z0-9._]+[.])?wat2do[.]ca)$"
)
_POST_PATH = re.compile(r"^/(?:p|reel)/([A-Za-z0-9_-]+)/?$")
_APPLESCRIPT_LOCK = threading.RLock()
_NAVIGATION_LOCK = threading.Lock()
_LAST_NAVIGATION_AT: float | None = None
_VIEWPORT_SOURCE = "JSON.stringify({width: window.innerWidth, height: window.innerHeight})"
_PAGE_RESPONSE_SOURCE = """JSON.stringify({
 path: window.location.pathname,
 rate_limited: document.readyState === "complete" &&
  document.title === "www.instagram.com" &&
  document.querySelector("#main-frame-error .error-code")?.textContent.trim() === "HTTP ERROR 429"
})"""
_SELECT_TAB_SCRIPT = """
on run
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindowId in (get id of every window)
            try
                set browserWindow to window id (contents of browserWindowId)
                repeat with browserTabId in (get id of every tab of browserWindow)
                    try
                        set browserTab to tab id (contents of browserTabId) of browserWindow
                        if URL of browserTab starts with "https://www.instagram.com/" then
                            return (id of browserTab) as text
                        end if
                    on error detail number errorCode
                        if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                        if exists tab id (contents of browserTabId) of browserWindow then error detail number errorCode
                    end try
                end repeat
            on error detail number errorCode
                if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                if exists window id (contents of browserWindowId) then error detail number errorCode
            end try
        end repeat
    end tell
    error "No existing Instagram tab."
end run
""".strip()
_EXECUTE_TAB_SCRIPT = f"""
on run argv
    set intendedTabId to item 1 of argv
    set javascriptSource to item 2 of argv
    set intendedWindowId to item 3 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id intendedWindowId
        if not (exists tab id intendedTabId of browserWindow) then
            error "Pinned Instagram tab is closed."
        end if
        set browserTab to tab id intendedTabId of browserWindow
        if URL of browserTab does not start with "https://www.instagram.com/" then
            error "Pinned Instagram tab changed site."
        end if
        if javascriptSource is not {json.dumps(_VIEWPORT_SOURCE)} and loading of browserTab then error "Pinned Instagram tab is loading."
        return execute browserTab javascript javascriptSource
    end tell
end run
""".strip()
_NAVIGATE_TAB_SCRIPT = """
on run argv
    set intendedTabId to item 1 of argv
    set targetUrl to item 2 of argv
    set intendedWindowId to item 3 of argv
    set reloadTarget to item 4 of argv
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        set browserWindow to window id intendedWindowId
        if not (exists tab id intendedTabId of browserWindow) then error "Pinned Instagram tab is closed."
        set browserTab to tab id intendedTabId of browserWindow
        if URL of browserTab does not start with "https://www.instagram.com/" then error "Pinned Instagram tab changed site."
        set currentUrl to URL of browserTab
        if currentUrl starts with "https://www.instagram.com/accounts/login" or currentUrl starts with "https://www.instagram.com/accounts/suspended" or currentUrl starts with "https://www.instagram.com/challenge" or currentUrl starts with "https://www.instagram.com/checkpoint" then error "Instagram requires human account recovery."
        if reloadTarget is "false" and URL of browserTab is targetUrl then return "already_open"
        set URL of browserTab to targetUrl
        return "navigating"
    end tell
end run
""".strip()
_ACTIVATE_TAB_SCRIPT = """
on run argv
    set intendedTabId to item 1 of argv
    set intendedWindowId to item 2 of argv
    set minimumWindowWidth to (item 3 of argv) as integer
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        if not frontmost then error "Brave must be foreground for worker viewport initialization."
        if ((id of front window) as text) is not intendedWindowId then error "Brave must be foreground for worker viewport initialization."
        set browserWindow to window id intendedWindowId
        set previousTabId to (id of active tab of browserWindow) as text
        set tabIds to get id of every tab of browserWindow
        repeat with tabIndex from 1 to count tabIds
            if ((item tabIndex of tabIds) as text) is intendedTabId then
                if URL of tab id intendedTabId of browserWindow does not start with "https://www.instagram.com/" then error "Pinned Instagram tab changed site."
                if previousTabId is not intendedTabId then
                    if not frontmost then error "Brave must be foreground for worker viewport initialization."
                    if ((id of front window) as text) is not intendedWindowId then error "Brave must be foreground for worker viewport initialization."
                    set active tab index of browserWindow to tabIndex
                end if
                if minimumWindowWidth > 0 then
                    set windowBounds to bounds of browserWindow
                    set windowWidth to (item 3 of windowBounds) - (item 1 of windowBounds)
                    set viewportWidth to (execute tab id intendedTabId of browserWindow javascript "window.innerWidth") as integer
                    set targetWidth to minimumWindowWidth
                    if viewportWidth > 0 then set targetWidth to minimumWindowWidth + windowWidth - viewportWidth
                    if windowWidth < targetWidth then
                        set item 3 of windowBounds to (item 1 of windowBounds) + targetWidth
                        if not frontmost then error "Brave must be foreground for worker viewport initialization."
                        if ((id of front window) as text) is not intendedWindowId then error "Brave must be foreground for worker viewport initialization."
                        set bounds of browserWindow to windowBounds
                    end if
                end if
                return previousTabId
            end if
        end repeat
    end tell
    error "Pinned Instagram tab is closed."
end run
""".strip()
_RESTORE_ACTIVE_TAB_SCRIPT = """
on run argv
    set intendedTabId to item 1 of argv
    set previousTabId to item 2 of argv
    set intendedWindowId to item 3 of argv
    if application "Brave Browser" is not running then error "Brave is not running."
    tell application "Brave Browser"
        if not (exists window id intendedWindowId) then error "Worker browser window is closed."
        if not frontmost then return "kept_active"
        if ((id of front window) as text) is not intendedWindowId then return "kept_active"
        if previousTabId is intendedTabId then return "kept_active"
        set browserWindow to window id intendedWindowId
        if ((id of active tab of browserWindow) as text) is not intendedTabId then return "kept_active"
        set tabIds to get id of every tab of browserWindow
        repeat with tabIndex from 1 to count tabIds
            if ((item tabIndex of tabIds) as text) is previousTabId then
                if not frontmost then return "kept_active"
                if ((id of front window) as text) is not intendedWindowId then return "kept_active"
                if ((id of active tab of browserWindow) as text) is not intendedTabId then return "kept_active"
                set active tab index of browserWindow to tabIndex
                return "restored"
            end if
        end repeat
    end tell
    return "kept_active"
end run
""".strip()

JavascriptRunner = Callable[[str, float], str]


class BrowserSessionError(RuntimeError):
    """A sanitized failure in the shared authenticated browser session."""


class BrowserEngagementUncertain(BrowserSessionError):
    """A native action may have executed without verified completion."""


class _BrowserAutomationTransient(BrowserSessionError):
    """An unavailable Apple Event bridge; only proven idempotent operations may retry."""


class _BrowserTabUnavailable(BrowserSessionError):
    """The exact pinned document is gone; drain its batch before repairing the pool."""


class _BrowserReadCleanupPending(BrowserSessionError):
    """A secondary read must be settled by the batch owner after other futures drain."""

    def __init__(
        self,
        message: str,
        *,
        operation_error: BaseException | None = None,
        completed_payload: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.operation_error = operation_error
        self.completed_payload = completed_payload


class BrowserAccountChanged(BrowserSessionError):
    """The shared login changed; drain all tabs before preparing another batch."""


class BrowserRateLimited(BrowserSessionError):
    """Instagram returned a verified HTTP 429 response; defer shared browser work."""


class _BrowserPageUnavailable(BrowserSessionError):
    """Recoverable page readiness or account-control failure."""


class _PinnedBraveJavascriptRunner:
    """Pin one existing tab once; never create or silently replace that tab."""

    def __init__(self, tab_id: str | None = None, *, window_id: str | None = None) -> None:
        self._tab_id = tab_id
        self._window_id = window_id
        self._viewport_ready = False

    def __call__(self, source: str, timeout_seconds: float) -> str:
        deadline = time.monotonic() + timeout_seconds
        tab_id, window_id = self._pin(deadline)
        if not self._viewport_ready:
            self.warm_viewport(_bridge_time_left(deadline))
        return self._execute(source, tab_id, window_id, deadline)

    def _execute(self, source: str, tab_id: str, window_id: str, deadline: float) -> str:
        while True:
            try:
                return self._execute_once(source, tab_id, window_id, deadline)
            except _BrowserPageUnavailable:
                # Native loading is checked before execute. No source ran yet,
                # so waiting here cannot replay a query or engagement click.
                time.sleep(min(_CONTROL.poll_interval_seconds, _bridge_time_left(deadline)))

    def _execute_once(self, source: str, tab_id: str, window_id: str, deadline: float) -> str:
        try:
            return _run_applescript(
                _EXECUTE_TAB_SCRIPT,
                (tab_id, source, window_id),
                _bridge_time_left(deadline),
            )
        except BrowserSessionError as exc:
            self._verify_closed_document(exc, deadline)
            raise

    def _viewport_is_ready(
        self, tab_id: str, window_id: str, deadline: float, *, minimum_width: int = 0
    ) -> bool:
        raw = self._execute_once(_VIEWPORT_SOURCE, tab_id, window_id, deadline)
        try:
            viewport = json.loads(raw)
        except json.JSONDecodeError:
            raise BrowserSessionError("Instagram browser returned invalid viewport state") from None
        if not isinstance(viewport, dict):
            raise BrowserSessionError("Instagram browser returned invalid viewport state")
        width, height = viewport.get("width"), viewport.get("height")
        if (
            isinstance(width, bool)
            or isinstance(height, bool)
            or not isinstance(width, (int, float))
            or not isinstance(height, (int, float))
        ):
            raise BrowserSessionError("Instagram browser returned invalid viewport state")
        return width > 0 and width >= minimum_width and height > 0

    def warm_viewport(self, timeout_seconds: float, *, primary: bool = False) -> None:
        """Read ready renderers in background; cold initialization cannot steal app focus."""
        deadline = time.monotonic() + timeout_seconds
        tab_id, window_id = self._pin(deadline)
        minimum_width = _CONTROL.primary_minimum_viewport_width if primary else 0
        self._viewport_ready = False
        probe_deadline = time.monotonic() + min(
            _CONTROL.viewport_warm_timeout_seconds, _bridge_time_left(deadline)
        )
        try:
            if self._viewport_is_ready(
                tab_id, window_id, probe_deadline, minimum_width=minimum_width
            ):
                self._viewport_ready = True
                return
        except (_BrowserAutomationTransient, _BrowserPageUnavailable):
            pass
        last_error: BrowserSessionError | None = None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                if last_error:
                    raise last_error
                if primary:
                    raise _BrowserPageUnavailable(
                        "Instagram primary desktop viewport did not become ready"
                    )
                raise _BrowserPageUnavailable("Instagram browser viewport did not become ready")
            if not _APPLESCRIPT_LOCK.acquire(timeout=remaining):
                raise _BrowserAutomationTransient("Brave browser automation timed out")
            transaction_started = time.monotonic()
            transaction_deadline = transaction_started + min(
                _CONTROL.viewport_warm_timeout_seconds, max(0, deadline - transaction_started)
            )
            sample_deadline = transaction_started + (transaction_deadline - transaction_started) / 2
            previous_id = None
            ready = False
            try:
                previous_id = _run_applescript(
                    _ACTIVATE_TAB_SCRIPT,
                    (tab_id, window_id, str(minimum_width)),
                    _bridge_time_left(sample_deadline),
                ).strip()
                if not previous_id.isascii() or not previous_id.isdigit():
                    raise BrowserSessionError("Brave returned an invalid active tab identity")
                ready = self._viewport_is_ready(
                    tab_id, window_id, sample_deadline, minimum_width=minimum_width
                )
                last_error = None
            except (_BrowserAutomationTransient, _BrowserPageUnavailable) as exc:
                last_error = exc
            finally:
                try:
                    if previous_id:
                        _run_applescript(
                            _RESTORE_ACTIVE_TAB_SCRIPT,
                            (tab_id, previous_id, window_id),
                            _bridge_time_left(transaction_deadline),
                        )
                finally:
                    _APPLESCRIPT_LOCK.release()
            if ready:
                self._viewport_ready = True
                return
            remaining = deadline - time.monotonic()
            # Activation, one sample and restoration are atomic. Page waits are
            # outside that transaction so other tabs can use the transport.
            if remaining > 0:
                time.sleep(min(_CONTROL.poll_interval_seconds, remaining))

    def navigate(self, url: str, timeout_seconds: float, *, reload: bool = False) -> str:
        deadline = time.monotonic() + timeout_seconds
        tab_id, window_id = self._pin(deadline)
        try:
            result = _dispatch_navigation(
                _NAVIGATE_TAB_SCRIPT, (tab_id, url, window_id, json.dumps(reload)), deadline
            )
            if result.strip() == "navigating":
                self._viewport_ready = False
            return result
        except BrowserSessionError as exc:
            self._verify_closed_document(exc, deadline)
            raise

    def _pin(self, deadline: float) -> tuple[str, str]:
        if self._tab_id is None:
            tab_id = _read_applescript(_SELECT_TAB_SCRIPT, (), _bridge_time_left(deadline)).strip()
            if not tab_id.isascii() or not tab_id.isdigit():
                raise BrowserSessionError("Brave returned an invalid Instagram tab identity")
            self._tab_id = tab_id
        if self._window_id is None:
            window_id = _read_applescript(
                _WORKER_WINDOW_SCRIPT, (self._tab_id,), _bridge_time_left(deadline)
            ).strip()
            if not window_id.isascii() or not window_id.isdigit():
                raise BrowserSessionError("Brave returned an invalid worker window identity")
            self._window_id = window_id
        assert self._tab_id is not None and self._window_id is not None
        return self._tab_id, self._window_id

    def _verify_closed_document(self, exc: BrowserSessionError, deadline: float) -> None:
        if str(exc) != "The pinned Instagram tab was closed":
            return
        assert self._tab_id is not None
        try:
            # One native proof also serves atomic viewport sampling; retries
            # belong to the surrounding read owner after transport release.
            _run_applescript(_WORKER_WINDOW_SCRIPT, (self._tab_id,), _bridge_time_left(deadline))
        except BrowserSessionError as location_error:
            if str(location_error) == "The pinned Instagram tab was closed":
                raise exc from None
            raise
        raise BrowserSessionError(
            "The pinned Instagram tab left its registered window; inspect before retrying"
        ) from None


class BrowserInstagramSession:
    """Shared identity, navigation, polling and async request lifecycle owner.

    The Mac worker holds its process-wide browser lock for an entire operation.
    All browser consumers use this class, which also refuses to switch accounts
    until any prior asynchronous request has stopped.
    """

    def __init__(
        self,
        *,
        javascript_runner: JavascriptRunner | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        allow_account_switch: bool = True,
        job_timeout_seconds: float | None = None,
    ) -> None:
        self._javascript_runner = javascript_runner or _PinnedBraveJavascriptRunner()
        self._sleep = sleep
        self._monotonic = monotonic
        self._allow_account_switch = allow_account_switch
        self._deadline = monotonic() + job_timeout_seconds if job_timeout_seconds else None

    def reset_job_deadline(self, timeout_seconds: float) -> None:
        """Start a fresh bounded job on a settled reusable tab."""
        self._deadline = self._monotonic() + timeout_seconds

    @property
    def is_secondary_read_tab(self) -> bool:
        """Require both the secondary role and an exact native tab owner."""
        return not self._allow_account_switch and isinstance(
            self._javascript_runner, _PinnedBraveJavascriptRunner
        )

    def run(self, source: str) -> str:
        return self._javascript_runner(source, self._remaining_timeout()).strip()

    def read(self, source: str) -> str:
        """Retry a read without replaying navigation, queries, or engagement clicks."""
        return _retry_bridge_operation(
            lambda timeout: self._javascript_runner(source, timeout),
            self._remaining_timeout(),
            sleep=self._sleep,
            monotonic=self._monotonic,
        ).strip()

    def current_page_path(self, *, check_response: bool = False) -> str:
        """Allow a bounded account transition, then reject human recovery routes."""

        def read_path() -> str:
            raw = self.read(_PAGE_RESPONSE_SOURCE if check_response else "window.location.pathname")
            if not check_response:
                return raw
            try:
                response = json.loads(raw)
            except json.JSONDecodeError:
                raise BrowserSessionError(
                    "Instagram browser returned invalid page response"
                ) from None
            if (
                not isinstance(response, dict)
                or set(response) != {"path", "rate_limited"}
                or not isinstance(response["path"], str)
                or not response["path"].startswith("/")
                or not isinstance(response["rate_limited"], bool)
            ):
                raise BrowserSessionError("Instagram browser returned invalid page response")
            if response["rate_limited"]:
                raise BrowserRateLimited("Instagram browser is rate limited (HTTP 429)")
            return response["path"]

        path = read_path()
        if path.startswith("/accounts/login"):
            self._sleep(min(_CONTROL.account_transition_grace_seconds, self._remaining_timeout()))
            path = read_path()
        if path.startswith(("/accounts/login", "/accounts/suspended", "/challenge", "/checkpoint")):
            raise BrowserSessionError("Instagram browser requires human account recovery")
        return path

    def navigate(self, url: str, *, reload: bool = False) -> str:
        """Navigate through Brave's native URL setter without waiting on a renderer."""
        target = urlsplit(url)
        if (
            target.scheme != "https"
            or target.netloc != "www.instagram.com"
            or not target.path.startswith("/")
            or target.query
            or target.fragment
        ):
            raise BrowserSessionError("Instagram browser navigation target is invalid")
        navigation = getattr(self._javascript_runner, "navigate", None)
        if navigation is None:
            raise BrowserSessionError("Instagram browser native navigation is unavailable")
        return navigation(url, self._remaining_timeout(), reload=reload).strip()

    def retire_unresponsive_read_tab(self) -> None:
        """Destroy only a pinned secondary read document, then prove it no longer exists."""
        if not self.is_secondary_read_tab:
            raise BrowserSessionError("Only a pinned secondary read tab may be retired")
        runner = cast(_PinnedBraveJavascriptRunner, self._javascript_runner)
        if runner._tab_id is None or runner._window_id is None:
            raise BrowserSessionError("The secondary read tab identity is unavailable")
        _close_owned_tab(runner._tab_id, runner._window_id)

    def _remaining_timeout(self) -> float:
        timeout = _CONTROL.request_timeout_seconds
        if self._deadline is not None:
            remaining = self._deadline - self._monotonic()
            if remaining <= 0:
                raise TimeoutError("Instagram browser job exceeded its deadline")
            timeout = min(timeout, remaining)
        return timeout

    def activate_account(self, recipient_id: str, account_username: str) -> str:
        try:
            recipient_id = validate_recipient_id(recipient_id)
        except ValueError:
            raise BrowserSessionError("Instagram browser recipient ID is invalid") from None
        try:
            username = validate_account_username(account_username)
        except ValueError as exc:
            raise BrowserSessionError(str(exc)) from None
        self.cancel_pending_request()
        if self._allow_account_switch and isinstance(
            self._javascript_runner, _PinnedBraveJavascriptRunner
        ):
            # Background renderers may retain a positive mobile viewport after
            # the existing window was resized. Refresh primary UI geometry
            # before reading or clicking its account and engagement controls.
            self._javascript_runner.warm_viewport(self._remaining_timeout(), primary=True)
        try:
            self._prepare_account(recipient_id, username)
        except _BrowserPageUnavailable:
            self.navigate(_account_profile_url(username), reload=True)
            self._prepare_account(recipient_id, username, check_response=True)
        return username

    def verify_account(self, recipient_id: str, username: str) -> None:
        if (
            self.current_account_username() != username
            or self.read(_recipient_is_active_source(recipient_id)) != "true"
        ):
            raise BrowserAccountChanged(
                "Instagram browser account does not match the intended account"
            )

    def current_account_username(self) -> str | None:
        username = self.read(_current_account_username_source())
        if not username:
            return None
        if not _USERNAME_PATTERN.fullmatch(username):
            raise BrowserSessionError("Active Instagram browser account is invalid or ambiguous")
        return username.casefold()

    def navigate_post(self, post_url: str, recipient_id: str, username: str) -> str:
        canonical_url = canonical_post_url(post_url)
        self.verify_account(recipient_id, username)
        try:
            self.navigate(canonical_url)
        except BrowserSessionError as exc:
            raise BrowserSessionError(f"Instagram post navigation failed: {exc}") from None
        try:

            def ready() -> bool:
                self.current_page_path(check_response=True)
                return self.read(f"({_post_context_source(canonical_url)}).status") == "ready"

            self.poll_until(ready)
        except _BrowserPageUnavailable:
            raise BrowserSessionError(
                "Instagram post did not become ready for the intended permalink"
            ) from None
        try:
            self.poll_until(lambda: self.current_account_username() is not None)
        except _BrowserPageUnavailable:
            raise BrowserSessionError(
                "Instagram account identity did not become ready after opening the post"
            ) from None
        self.verify_account(recipient_id, username)
        return canonical_url

    def query(self, source: str) -> dict[str, Any]:
        """Read result and settlement together; cancel every exit without that proof."""
        self.cancel_pending_request()
        payload: dict[str, Any] | None = None
        operation_error: BaseException | None = None
        completion_settled = False

        def completed() -> bool:
            nonlocal payload, completion_settled
            raw = self.read(
                f"""JSON.stringify((() => {{
 const request = window[{json.dumps(_REQUEST_KEY)}];
 return request ? {{result: request.result ?? null, settled: request.settled}} : null;
}})())"""
            )
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                raise BrowserSessionError(
                    "Instagram browser returned invalid request state"
                ) from None
            if value is None:
                return False
            if (
                not isinstance(value, dict)
                or set(value) != {"result", "settled"}
                or not isinstance(value["settled"], bool)
            ):
                raise BrowserSessionError("Instagram browser returned invalid request state")
            result = value["result"]
            if result is None:
                return False
            if not isinstance(result, dict) or result.get("state") not in (
                "pending",
                "succeeded",
                "failed",
            ):
                raise BrowserSessionError("Instagram browser returned invalid request state")
            if result["state"] == "pending":
                return False
            payload = result
            completion_settled = value["settled"]
            return completion_settled

        try:
            self.run(source)
            self.poll_until(completed)
        except BaseException as exc:
            operation_error = exc
            raise
        finally:
            if not completion_settled:
                try:
                    self.cancel_pending_request()
                except BrowserSessionError as exc:
                    if self.is_secondary_read_tab:
                        raise _BrowserReadCleanupPending(
                            str(exc), operation_error=operation_error, completed_payload=payload
                        ) from None
                    raise
        if payload is None:
            raise BrowserSessionError("Instagram browser returned no request result")
        return payload

    def cancel_pending_request(self) -> None:
        """Abort and await settlement, including requests left by an interrupted job."""
        job_deadline = self._deadline
        cleanup_budget = (
            _CONTROL.interaction_timeout_seconds
            if self._allow_account_switch
            else _CONTROL.secondary_cleanup_timeout_seconds
        )
        cleanup_deadline = self._monotonic() + cleanup_budget
        self._deadline = cleanup_deadline
        last_error: BrowserSessionError | None = None
        try:
            for attempt in range(_CONTROL.bridge_retry_limit):
                try:
                    self.poll_until(lambda: self.run(_cancel_request_source()) == "settled")
                    self.run(f"delete window[{json.dumps(_REQUEST_KEY)}]; 'cleared'")
                    return
                except _BrowserAutomationTransient as exc:
                    last_error = exc
                    remaining = cleanup_deadline - self._monotonic()
                    if remaining <= 0 or attempt + 1 == _CONTROL.bridge_retry_limit:
                        raise
                    self._sleep(min(_CONTROL.poll_interval_seconds, remaining))
        except BrowserSessionError as exc:
            if str(exc) == "The pinned Instagram tab was closed":
                # Its document no longer exists; no async page request can be reused.
                return
            raise BrowserSessionError(
                f"Instagram browser request cancellation could not be confirmed: {exc}"
            ) from None
        except TimeoutError:
            reason = str(last_error) if last_error else "the browser job deadline expired"
            raise BrowserSessionError(
                f"Instagram browser request cancellation could not be confirmed: {reason}"
            ) from None
        finally:
            self._deadline = job_deadline

    def poll_until(self, completed: Callable[[], bool]) -> None:
        deadline = self._monotonic() + _CONTROL.interaction_timeout_seconds
        job_deadline = self._deadline
        self._deadline = min(deadline, job_deadline) if job_deadline is not None else deadline
        try:
            while self._monotonic() < self._deadline:
                try:
                    if completed():
                        return
                except _BrowserPageUnavailable as exc:
                    if str(exc) != "The pinned Instagram tab is loading":
                        raise
                remaining = self._deadline - self._monotonic()
                if remaining > 0:
                    self._sleep(min(_CONTROL.poll_interval_seconds, remaining))
            raise _BrowserPageUnavailable("Instagram browser automation timed out")
        finally:
            self._deadline = job_deadline

    def _prepare_account(
        self, recipient_id: str, username: str, *, check_response: bool = False
    ) -> None:
        active_username = None

        def readable() -> bool:
            nonlocal active_username
            if check_response:
                self.current_page_path(check_response=True)
            active_username = self.current_account_username()
            return active_username is not None

        self.poll_until(readable)
        if active_username != username:
            if not self._allow_account_switch:
                raise BrowserAccountChanged(
                    "Instagram browser account changed during parallel work"
                )
            self._switch_account(username)
        self.verify_account(recipient_id, username)
        if self.read(_account_chooser_state_source()) == "ready":
            if self.run(_close_account_chooser_source()) != "clicked":
                raise BrowserSessionError("Instagram account chooser could not be closed")

    def _open_account_chooser(self) -> None:
        if self.read(_account_chooser_state_source()) == "ready":
            return
        if self.read(_switch_button_state_source()) != "ready":
            if self.run(_open_more_source()) != "clicked":
                raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
            self.poll_until(lambda: self.read(_switch_button_state_source()) == "ready")
        if self.run(_click_switch_accounts_source()) != "clicked":
            raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
        self.poll_until(lambda: self.read(_account_chooser_state_source()) == "ready")

    def _switch_account(self, username: str) -> None:
        self._open_account_chooser()
        selected = self.run(_click_account_source(username))
        if selected == "ambiguous":
            raise BrowserSessionError("Matching Instagram browser account is ambiguous")
        if selected != "clicked":
            raise BrowserSessionError("Matching Instagram browser account is unavailable")

        def switched() -> bool:
            self.current_page_path(check_response=True)
            return self.current_account_username() == username

        self.poll_until(switched)


def school_account_username(school_slug: str) -> str:
    """Resolve the current account name from its immutable school mapping."""
    return validate_account_username(f"wat2do.{school_slug}")


def validate_account_username(value: object) -> str:
    """Normalize one configured school account at every browser admission path."""
    if not isinstance(value, str):
        raise ValueError("Instagram browser account username is invalid")
    username = value.strip().casefold()
    if not _USERNAME_PATTERN.fullmatch(username) or not _WAT2DO_ACCOUNT_PATTERN.fullmatch(username):
        raise ValueError("Instagram browser account username is invalid")
    return username


def canonical_post_url(post_url: str) -> str:
    """Only allow an Instagram post/reel permalink, never arbitrary navigation."""
    try:
        parsed = urlsplit(post_url.strip())
    except ValueError:
        raise BrowserSessionError("Instagram engagement post URL is invalid") from None
    if (
        parsed.scheme != "https"
        or parsed.netloc not in {"instagram.com", "www.instagram.com"}
        or not _POST_PATH.fullmatch(parsed.path)
    ):
        raise BrowserSessionError("Instagram engagement post URL is invalid")
    return f"https://www.instagram.com{parsed.path.rstrip('/')}/"


def _account_profile_url(username: str) -> str:
    if not isinstance(username, str) or not _USERNAME_PATTERN.fullmatch(username):
        raise BrowserSessionError("Instagram browser profile username is invalid")
    return f"https://www.instagram.com/{username}/"


def _bridge_time_left(deadline: float) -> float:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise _BrowserAutomationTransient("Brave browser automation timed out")
    return remaining


def _dispatch_navigation(script: str, arguments: tuple[str, ...], deadline: float) -> str:
    """Pace all native page loads, including newly created worker tabs."""
    global _LAST_NAVIGATION_AT
    if not _NAVIGATION_LOCK.acquire(timeout=_bridge_time_left(deadline)):
        raise _BrowserAutomationTransient("Brave browser automation timed out")
    try:
        if _LAST_NAVIGATION_AT is not None:
            while True:
                wait = _LAST_NAVIGATION_AT + _CONTROL.navigation_interval_seconds - time.monotonic()
                if wait <= 0:
                    break
                # Page-load pacing never owns the transport while sleeping.
                time.sleep(min(wait, _bridge_time_left(deadline)))
        if not _APPLESCRIPT_LOCK.acquire(timeout=_bridge_time_left(deadline)):
            raise _BrowserAutomationTransient("Brave browser automation timed out")
        try:
            _bridge_time_left(deadline)
            # Record dispatch after transport acquisition, including an
            # uncertain send. Native mutations are never replayed here.
            _LAST_NAVIGATION_AT = time.monotonic()
            return _run_applescript(script, arguments, _bridge_time_left(deadline))
        finally:
            _APPLESCRIPT_LOCK.release()
    finally:
        _NAVIGATION_LOCK.release()


def _run_applescript(script: str, arguments: tuple[str, ...], timeout_seconds: float) -> str:
    deadline = time.monotonic() + timeout_seconds
    if not _APPLESCRIPT_LOCK.acquire(timeout=timeout_seconds):
        raise _BrowserAutomationTransient("Brave browser automation timed out")
    try:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _BrowserAutomationTransient("Brave browser automation timed out")
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", script, "--", *arguments],
            capture_output=True,
            text=True,
            check=True,
            timeout=min(remaining, _CONTROL.apple_event_timeout_seconds),
        )
    except FileNotFoundError:
        raise BrowserSessionError("AppleScript is unavailable on this host") from None
    except subprocess.TimeoutExpired:
        raise _BrowserAutomationTransient("Brave browser automation timed out") from None
    except subprocess.CalledProcessError as exc:
        detail = f"{exc.stderr}\n{exc.stdout}"
        messages = {
            "Not authorized to send Apple events": "Allow the Mac runner to control Brave in System Settings > Privacy & Security > Automation",
            "(-1743)": "Allow the Mac runner to control Brave in System Settings > Privacy & Security > Automation",
            "Executing JavaScript through AppleScript is turned off": "Enable Brave View > Developer > Allow JavaScript from Apple Events",
            "Brave is not running": "Open Brave with the logged-in Instagram accounts",
            "No existing Instagram tab": "Open an Instagram tab in Brave with the logged-in accounts",
            "Pinned Instagram tab changed site": "The pinned Brave tab is no longer on Instagram",
            "Pinned Instagram tab is closed": "The pinned Instagram tab was closed",
            "Pinned Instagram tab is loading": "The pinned Instagram tab is loading",
            "Worker browser window is closed": "The registered worker browser window was closed",
            "Instagram requires human account recovery": "Instagram browser requires human account recovery",
            "Brave must be foreground for worker viewport initialization": "Bring the registered Instagram window to the foreground briefly to initialize its worker tabs, then resume the browser worker",
        }
        for detail_match, message in messages.items():
            if detail_match in detail:
                error = (
                    _BrowserTabUnavailable
                    if detail_match == "Pinned Instagram tab is closed"
                    else _BrowserPageUnavailable
                    if detail_match == "Pinned Instagram tab is loading"
                    else BrowserSessionError
                )
                raise error(message) from None
        code = re.search(r"\((-?\d+)\)", detail)
        suffix = f" (Apple Event {code.group(1)})" if code else ""
        error = (
            _BrowserAutomationTransient
            if code and code.group(1) in {"-1719", "-1728", "-1712", "-600", "-609"}
            else BrowserSessionError
        )
        raise error(f"Brave could not run Instagram browser automation{suffix}") from None
    finally:
        _APPLESCRIPT_LOCK.release()
    return completed.stdout


def _retry_bridge_operation(
    operation: Callable[[float], str],
    timeout_seconds: float,
    *,
    sleep: Callable[[float], None] = time.sleep,
    monotonic: Callable[[], float] = time.monotonic,
) -> str:
    """Retry only explicitly idempotent bridge operations within their original budget."""
    deadline = monotonic() + timeout_seconds
    for attempt in range(_CONTROL.bridge_retry_limit):
        remaining = deadline - monotonic()
        if remaining <= 0:
            raise _BrowserAutomationTransient("Brave browser automation timed out")
        try:
            return operation(remaining)
        except _BrowserAutomationTransient:
            remaining = deadline - monotonic()
            if remaining <= 0 or attempt + 1 == _CONTROL.bridge_retry_limit:
                raise
            sleep(min(_CONTROL.poll_interval_seconds, remaining))
    raise AssertionError("Validated bridge retry limit must be positive")


def _read_applescript(script: str, arguments: tuple[str, ...], timeout_seconds: float) -> str:
    return _retry_bridge_operation(
        lambda timeout: _run_applescript(script, arguments, timeout), timeout_seconds
    )


def _cancel_request_source() -> str:
    return f"""
(() => {{
  const request = window[{json.dumps(_REQUEST_KEY)}];
  if (!request || request.settled) return "settled";
  request.controller.abort();
  return "pending";
}})()
""".strip()


def _open_more_source() -> str:
    return """
(() => {
  const settings = document.querySelector('[aria-label="Settings"]');
  const more = settings?.closest('a,[role="link"]');
  if (!more) return "missing";
  more.click();
  return "clicked";
})()
""".strip()


def _switch_button_state_source() -> str:
    return """
(() => [...document.querySelectorAll('button,[role="button"]')]
  .some(element => (element.innerText || element.textContent || "").trim() === "Switch accounts")
  ? "ready" : "pending")()
""".strip()


def _click_switch_accounts_source() -> str:
    return """
(() => {
  const button = [...document.querySelectorAll('button,[role="button"]')]
    .find(element =>
      (element.innerText || element.textContent || "").trim() === "Switch accounts"
    );
  if (!button) return "missing";
  button.click();
  return "clicked";
})()
""".strip()


def _account_chooser_state_source() -> str:
    return """
(() => [...document.querySelectorAll('h1,[role="heading"]')]
  .some(element =>
    (element.innerText || element.textContent || "").trim() === "Switch accounts"
  )
  ? "ready" : "pending")()
""".strip()


def _click_account_source(username: str) -> str:
    switcher_username = _CONTROL.school_switcher_username_overrides.get(
        username.removeprefix("wat2do."), username
    )
    return f"""
(() => {{
  const username = {json.dumps(username)};
  const switcherUsername = {json.dumps(switcher_username)};
  const heading = [...document.querySelectorAll('h1,[role="heading"]')]
    .find(element =>
      (element.innerText || element.textContent || "").trim() === "Switch accounts"
    );
  const dialog = heading?.closest('[role="dialog"]');
  const buttons = [...(dialog?.querySelectorAll('button,[role="button"]') || [])];
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const school = value => value.match(/^wat2do[.]([a-z0-9_]+)$/)?.[1] ||
    value.match(/^([a-z0-9_]+)[.]wat2do[.](?:io|ca)$/)?.[1];
  const exact = buttons.filter(element => label(element) === switcherUsername);
  // Instagram's saved account chooser can retain its pre-rename label.
  // This only selects an entry: active username and recipient ID are verified after switching.
  const expectedSchool = school(username);
  const matches = exact.length ? exact : buttons.filter(element =>
    expectedSchool && school(label(element)) === expectedSchool);
  if (!matches.length) return "missing";
  if (matches.length !== 1) return "ambiguous";
  const button = matches[0];
  button.scrollIntoView({{behavior: "instant", block: "center"}});
  button.click();
  return "clicked";
}})()
""".strip()


def _current_account_username_source() -> str:
    return r"""
(() => {
  if (document.readyState !== "complete") return "";
  const profileLabel = element => [element.getAttribute("aria-label"),
    element.getAttribute("title"), element.innerText || element.textContent || ""]
    .some(value => (value || "").trim().toLowerCase() === "profile");
  const compactNavigation = candidate => {
    let scope = candidate.parentElement;
    for (let depth = 1; scope && depth <= 8; depth++, scope = scope.parentElement) {
      if (scope.matches('body,html,main,article,[role="main"],[role="dialog"]')) return false;
      const links = [...scope.querySelectorAll("a[href]")];
      const core = ["/explore/", "/reels/", "/direct/inbox/"]
        .map(route => links.find(link => link.getAttribute("href") === route));
      if (core.some(link => !link)) continue;
      // Find the actual route container, rather than accepting a page wrapper
      // that happens to contain both navigation and a viewed profile avatar.
      let navigation = core[0].parentElement;
      while (navigation !== scope && !core.every(link => navigation.contains(link))) {
        navigation = navigation.parentElement;
      }
      if (navigation.contains(candidate) &&
          !navigation.querySelector('main,article,[role="main"],[role="dialog"]') &&
          [...navigation.querySelectorAll("a[href]")].some(link => link.getAttribute("href") === "/")) {
        return true;
      }
    }
    return false;
  };
  const anchors = [...document.querySelectorAll("a[href]")].filter(candidate => {
    // Viewed profile headers and post avatars do not identify the logged account.
    // During navigation hydration, a public avatar may occupy the sidebar's old position.
    if (candidate.closest('main,article,[role="main"],[role="dialog"],[aria-hidden="true"]')) return false;
    const image = candidate.querySelector("img[alt]");
    const avatarUsername = (image?.getAttribute("alt") || "").match(/^([A-Za-z0-9._]{1,30})'s profile picture$/)?.[1];
    const hrefUsername = (candidate.getAttribute("href") || "").match(/^\/([A-Za-z0-9._]{1,30})\/$/)?.[1];
    if (!avatarUsername || !hrefUsername || avatarUsername.toLowerCase() !== hrefUsername.toLowerCase()) return false;
    const ownedControl = candidate.closest('nav,[role="navigation"]') || profileLabel(candidate) ||
      [...candidate.querySelectorAll('[aria-label],title')].some(profileLabel) || compactNavigation(candidate);
    if (!ownedControl) return false;
    const bounds = candidate.getBoundingClientRect();
    const style = getComputedStyle(candidate);
    return bounds.width > 0 && bounds.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  });
  const usernames = [...new Set(anchors.map(anchor =>
    anchor.getAttribute("href").split("/").filter(Boolean)[0].toLowerCase()))];
  return usernames.length > 1 ? "!ambiguous" : (usernames[0] || "");
})()
""".strip()


def _recipient_is_active_source(recipient_id: str) -> str:
    return f"""
(() => {{
  const entry = document.cookie.split(";").map(value => value.trim())
    .find(value => value.startsWith("ds_user_id="));
  const activeRecipient = entry?.slice("ds_user_id=".length) || "";
  return activeRecipient === {json.dumps(recipient_id)} ? "true" : "false";
}})()
""".strip()


def _close_account_chooser_source() -> str:
    return """
(() => {
  const headings = [...document.querySelectorAll('h1,[role="heading"]')].filter(element =>
    (element.innerText || element.textContent || "").trim() === "Switch accounts");
  if (headings.length !== 1) return "missing";
  const dialog = headings[0].closest('[role="dialog"]');
  const closeIcons = [...(dialog?.querySelectorAll('[aria-label="Close"]') || [])];
  if (closeIcons.length !== 1) return "missing";
  const closeIcon = closeIcons[0];
  const close = closeIcon?.closest('button,[role="button"]');
  if (!close) return "missing";
  close.click();
  return "clicked";
})()
""".strip()


def _post_context_source(post_url: str) -> str:
    """Find the unique toolbar attached to the visible target post permalink.

    Instagram uses an article inside its modal but plain divs on standalone post
    pages. Their common structure is a section toolbar beside the post timestamp
    permalink, which can include the author's username before /p/ or /reel/.
    """
    return rf"""
(() => {{
  const fail = reason => ({{status: "failed", reason}});
  const expected = new URL({json.dumps(post_url)});
  if (window.location.origin !== expected.origin ||
      window.location.pathname.replace(/\/$/, "") !== expected.pathname.replace(/\/$/, "")) {{
    return fail("wrong_post");
  }}
  if (document.readyState !== "complete") return fail("not_ready");
  const visible = element => {{
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return bounds.width > 0 && bounds.height > 0 &&
      style.visibility !== "hidden" && style.display !== "none" &&
      !element.closest('[aria-hidden="true"]');
  }};
  const labels = element => [...element.querySelectorAll("[aria-label]")]
    .concat(element.matches("[aria-label]") ? [element] : [])
    .filter(visible).map(node => node.getAttribute("aria-label"));
  const isToolbar = section => {{
    const names = labels(section);
    return names.includes("Comment") && names.some(name => ["Like", "Unlike"].includes(name));
  }};
  const shortcode = href => {{
    try {{
      const url = new URL(href, expected.origin);
      if (url.origin !== expected.origin) return null;
      return url.pathname.match(/^\/(?:[A-Za-z0-9._]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/)?.[1] || null;
    }} catch (_error) {{
      return null;
    }}
  }};
  const expectedCode = shortcode(expected.href);
  const toolbars = [...document.querySelectorAll("section")].filter(isToolbar)
    .filter(section => ![...section.querySelectorAll("section")].some(isToolbar));
  const candidates = toolbars.map(toolbar => {{
    let post = toolbar.parentElement;
    while (post && post !== document.body) {{
      // A sibling post cannot lend its permalink to this toolbar, even through
      // an otherwise unmarked page wrapper.
      if ([...post.querySelectorAll('article,main,[role="main"]')]
          .filter(visible).some(container => !container.contains(toolbar))) return null;
      const links = [...post.querySelectorAll("a[href]")].filter(visible)
        .map(anchor => ({{anchor, code: shortcode(anchor.getAttribute("href"))}}))
        .filter(link => link.code);
      // A standalone MAIN may own its direct toolbar and direct timestamp.
      // Do not borrow a timestamp from another branch of the whole page.
      if (post.matches('main,[role="main"]') &&
          (toolbar.parentElement !== post ||
           links.some(link => link.anchor.parentElement !== post))) return null;
      const codes = links.map(link => link.code);
      if (codes.length) {{
        return codes.every(code => code === expectedCode) ? {{post, toolbar}} : null;
      }}
      // Do not search outside this post/article or across the whole feed.
      if (post.matches('article,main,[role="main"]')) return null;
      post = post.parentElement;
    }}
    return null;
  }}).filter(Boolean);
  if (candidates.length !== 1) return fail("ambiguous_post");
  const {{post, toolbar}} = candidates[0];
  if ([...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => visible(dialog) && !dialog.contains(post))) return fail("blocked");
  return {{status: "ready", post, toolbar, visible, labels}};
}})()
""".strip()


_CREATE_WORKER_TAB_SCRIPT = """
on run argv
    set registeredWindowId to item 1 of argv
    set placement to item 2 of argv
    set initialUrl to item 3 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        if not (exists window id registeredWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id registeredWindowId
        if not frontmost then error "Brave must be foreground for worker viewport initialization."
        if ((id of front window) as text) is not registeredWindowId then error "Brave must be foreground for worker viewport initialization."
        if placement is "first" then
            set workerTab to make new tab at beginning of tabs of browserWindow with properties {URL:initialUrl}
        else
            set workerTab to make new tab at end of tabs of browserWindow with properties {URL:initialUrl}
        end if
        return (id of workerTab) as text
    end tell
end run
""".strip()


_WORKER_TAB_INVENTORY_SCRIPT = """
on run argv
    set registeredWindowId to item 1 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    set foundIds to ""
    tell application "Brave Browser"
        if not (exists window id registeredWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id registeredWindowId
        repeat with requestedTabId in (rest of argv)
            set tabId to contents of requestedTabId
            if exists tab id tabId of browserWindow then
                try
                    set browserTab to tab id tabId of browserWindow
                    if URL of browserTab does not start with "https://www.instagram.com/" then
                        error "Pinned Instagram tab changed site."
                    end if
                    set foundIds to foundIds & tabId & linefeed
                on error detail number errorCode
                    if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                    if exists tab id tabId of browserWindow then error detail number errorCode
                end try
            end if
        end repeat
    end tell
    return foundIds
end run
""".strip()


_INSTAGRAM_TAB_INVENTORY_SCRIPT = """
on run argv
    set registeredWindowId to item 1 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    set foundIds to ""
    tell application "Brave Browser"
        if not (exists window id registeredWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id registeredWindowId
        repeat with browserTabId in (get id of every tab of browserWindow)
            try
                set browserTab to tab id (contents of browserTabId) of browserWindow
                if URL of browserTab starts with "https://www.instagram.com/" then
                    set foundIds to foundIds & ((id of browserTab) as text) & linefeed
                end if
            on error detail number errorCode
                if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                if exists tab id (contents of browserTabId) of browserWindow then error detail number errorCode
            end try
        end repeat
    end tell
    return foundIds
end run
""".strip()


_WORKER_WINDOW_SCRIPT = """
on run argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindowId in (get id of every window)
            try
                set browserWindow to window id (contents of browserWindowId)
                if (get id of every tab of browserWindow) contains (item 1 of argv) then
                    return (id of browserWindow) as text
                end if
            on error detail number errorCode
                if errorCode is not -1719 and errorCode is not -1728 then error detail number errorCode
                if exists window id (contents of browserWindowId) then error detail number errorCode
            end try
        end repeat
    end tell
    error "Pinned Instagram tab is closed."
end run
""".strip()


_CLOSE_WORKER_TAB_SCRIPT = """
on run argv
    set intendedTabId to item 1 of argv
    set registeredWindowId to item 2 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        if not (exists window id registeredWindowId) then
            error "Worker browser window is closed."
        end if
        set browserWindow to window id registeredWindowId
        if exists tab id intendedTabId of browserWindow then
            set browserTab to tab id intendedTabId of browserWindow
            if URL of browserTab does not start with "https://www.instagram.com/" then
                error "Pinned Instagram tab changed site."
            end if
            close browserTab
        end if
    end tell
    return "closed"
end run
""".strip()


def _close_owned_tab(tab_id: str, window_id: str) -> None:
    """Close one exact document and verify global absence before reusing browser ownership."""
    deadline = time.monotonic() + _CONTROL.interaction_timeout_seconds
    if (
        _retry_bridge_operation(
            lambda timeout: _run_applescript(
                _CLOSE_WORKER_TAB_SCRIPT, (tab_id, window_id), timeout
            ),
            min(_CONTROL.request_timeout_seconds, _bridge_time_left(deadline)),
        ).strip()
        != "closed"
    ):
        raise BrowserSessionError("Owned Instagram tab could not be closed")
    try:
        _read_applescript(
            _WORKER_WINDOW_SCRIPT,
            (tab_id,),
            min(_CONTROL.request_timeout_seconds, _bridge_time_left(deadline)),
        )
    except BrowserSessionError as exc:
        if str(exc) != "The pinned Instagram tab was closed":
            raise
    else:
        raise BrowserSessionError("Owned Instagram tab closure could not be confirmed")


class BrowserTabPool:
    """Worker-owned tabs in the existing Brave session, under the browser lock.

    Persist each new tab immediately. Keep the configured total, reserving the primary tab.
    Repair closed worker tabs inside their registered existing window. Account switching happens only after
    every pool tab's previous asynchronous request has settled.
    """

    def __init__(self, queue) -> None:
        self.queue = queue

    def _registered_ids(self) -> list[str]:
        ids = self.queue.get_setting("browser_tab_ids", [])
        if (
            not isinstance(ids, list)
            or any(
                not isinstance(tab_id, str) or not tab_id.isascii() or not tab_id.isdigit()
                for tab_id in ids
            )
            or len(set(ids)) != len(ids)
        ):
            raise BrowserSessionError("Worker tab registry is invalid; inspect before retrying")
        return ids

    def ensure_capacity(self, *, bootstrap_username: str | None = None) -> list[str]:
        ids = self._registered_ids()
        if not ids:
            runner = _PinnedBraveJavascriptRunner()
            runner("'pinned'", _CONTROL.request_timeout_seconds)
            assert runner._tab_id is not None
            ids = [runner._tab_id]
            self.queue.set_setting("browser_tab_ids", ids)
            self.queue.set_setting("browser_window_id", runner._window_id)
        window_id = self.queue.get_setting("browser_window_id")
        if not window_id:
            for tab_id in ids:
                try:
                    window_id = _read_applescript(
                        _WORKER_WINDOW_SCRIPT, (tab_id,), _CONTROL.request_timeout_seconds
                    ).strip()
                    break
                except BrowserSessionError as exc:
                    if str(exc) != "The pinned Instagram tab was closed":
                        raise
            if window_id:
                self.queue.set_setting("browser_window_id", window_id)
        if not isinstance(window_id, str) or not window_id.isascii() or not window_id.isdigit():
            raise BrowserSessionError(
                "No registered worker window remains; inspect before retrying"
            )
        live = set(
            _read_applescript(
                _WORKER_TAB_INVENTORY_SCRIPT,
                (window_id, *ids),
                _CONTROL.request_timeout_seconds,
            ).split()
        )
        if live - set(ids):
            raise BrowserSessionError("Brave returned an invalid worker tab inventory")
        for tab_id in set(ids) - live:
            try:
                _read_applescript(
                    _WORKER_WINDOW_SCRIPT, (tab_id,), _CONTROL.request_timeout_seconds
                )
            except BrowserSessionError as exc:
                if str(exc) != "The pinned Instagram tab was closed":
                    raise
            else:
                raise BrowserSessionError(
                    "An owned Instagram tab moved outside the registered worker window"
                )
        survivors = [tab_id for tab_id in ids if tab_id in live]
        bootstrap_username = (
            bootstrap_username
            or self.queue.get_setting("retrieval_pool_account")
            or self.queue.peek_account_username()
            or school_account_username(_CONTROL.bootstrap_profile_school)
        )
        if ids[0] not in live:
            profile_url = _account_profile_url(bootstrap_username)
            survivors.insert(0, self._create_tab(window_id, "first", profile_url))
            self.queue.set_setting("browser_tab_ids", survivors)
            self.queue.set_setting("retrieval_pool_account", None)
            _PinnedBraveJavascriptRunner(survivors[0], window_id=window_id).warm_viewport(
                _CONTROL.interaction_timeout_seconds
            )
        for tab_id in survivors[_CONTROL.parallel_tabs :]:
            self._close_settled_tab(tab_id, window_id)
            survivors.remove(tab_id)
            self.queue.set_setting("browser_tab_ids", survivors)
        primary = BrowserInstagramSession(
            javascript_runner=_PinnedBraveJavascriptRunner(survivors[0], window_id=window_id),
            job_timeout_seconds=_CONTROL.interaction_timeout_seconds,
        )
        path = primary.current_page_path()
        username = None if path == "/" else primary.current_account_username()
        if username is None:
            # Instagram's home endpoint can be a complete blank/error document
            # while public profiles still expose valid authenticated navigation.
            primary.navigate(_account_profile_url(bootstrap_username), reload=True)
            username = self._ready_username(primary)
        profile_url = _account_profile_url(username)
        available = self._instagram_tab_ids(window_id)
        ids = list(dict.fromkeys([*survivors, *available]))[: _CONTROL.parallel_tabs]
        for tab_id in available:
            if tab_id not in ids:
                self._close_settled_tab(tab_id, window_id)
        self.queue.set_setting("browser_tab_ids", ids)
        for tab_id in ids:
            if tab_id not in survivors:
                _PinnedBraveJavascriptRunner(tab_id, window_id=window_id).warm_viewport(
                    _CONTROL.interaction_timeout_seconds
                )
        while len(ids) < _CONTROL.parallel_tabs:
            tab_id = self._create_tab(window_id, "last", profile_url)
            if not tab_id.isascii() or not tab_id.isdigit() or tab_id in ids:
                raise BrowserSessionError("Brave returned an invalid worker tab identity")
            ids.append(tab_id)
            self.queue.set_setting("browser_tab_ids", ids)
            _PinnedBraveJavascriptRunner(tab_id, window_id=window_id).warm_viewport(
                _CONTROL.interaction_timeout_seconds
            )
        return ids

    @staticmethod
    def _instagram_tab_ids(window_id: str) -> list[str]:
        ids = _read_applescript(
            _INSTAGRAM_TAB_INVENTORY_SCRIPT, (window_id,), _CONTROL.request_timeout_seconds
        ).split()
        if len(ids) != len(set(ids)) or any(not tab.isascii() or not tab.isdigit() for tab in ids):
            raise BrowserSessionError("Brave returned an invalid Instagram tab inventory")
        return ids

    @classmethod
    def _create_tab(cls, window_id: str, placement: str, initial_url: str) -> str:
        before = set(cls._instagram_tab_ids(window_id))
        try:
            tab_id = _dispatch_navigation(
                _CREATE_WORKER_TAB_SCRIPT,
                (window_id, placement, initial_url),
                time.monotonic() + _CONTROL.request_timeout_seconds,
            ).strip()
        except _BrowserAutomationTransient:
            # A timed-out make command may already have created its document.
            # Reconcile the inventory instead of repeating the mutation.
            created = set(cls._instagram_tab_ids(window_id)) - before
            if len(created) != 1:
                raise
            tab_id = created.pop()
        if not tab_id.isascii() or not tab_id.isdigit() or tab_id in before:
            raise BrowserSessionError("Brave returned an invalid worker tab identity")
        return tab_id

    @staticmethod
    def _close_settled_tab(tab_id: str, window_id: str) -> None:
        try:
            BrowserInstagramSession(
                javascript_runner=_PinnedBraveJavascriptRunner(tab_id, window_id=window_id)
            ).cancel_pending_request()
        except BrowserSessionError as exc:
            if "cancellation could not be confirmed" not in str(exc):
                raise
            # This surplus document is being destroyed, never reused or switched.
            # Closing its exact ID is the final cancellation boundary.
        _close_owned_tab(tab_id, window_id)

    def settle_registered_tabs(self) -> list[BrowserInstagramSession]:
        """Settle every owned tab; retire only failed secondary reads before any switch."""
        window_id = self.queue.get_setting("browser_window_id")
        sessions = [
            BrowserInstagramSession(
                javascript_runner=_PinnedBraveJavascriptRunner(tab_id, window_id=window_id),
                allow_account_switch=index == 0,
            )
            for index, tab_id in enumerate(self._registered_ids())
        ]
        failures: list[BrowserSessionError] = []
        retired = False
        for index, session in enumerate(sessions):
            try:
                session.cancel_pending_request()
            except BrowserSessionError as exc:
                if index == 0 or "cancellation could not be confirmed" not in str(exc):
                    failures.append(exc)
                    continue
                try:
                    session.retire_unresponsive_read_tab()
                except BrowserSessionError:
                    failures.append(exc)
                else:
                    retired = True
        if failures:
            raise failures[0]
        if retired:
            raise _BrowserTabUnavailable("An unresponsive secondary Instagram tab was closed")
        return sessions

    @staticmethod
    def _ready_username(session: BrowserInstagramSession) -> str:
        username = None

        def readable() -> bool:
            nonlocal username
            session.current_page_path(check_response=True)
            username = session.current_account_username()
            return username is not None

        try:
            session.poll_until(readable)
        except _BrowserPageUnavailable:
            raise TimeoutError("Instagram account identity is temporarily unreadable") from None
        if username is None:
            raise TimeoutError("Instagram account identity is temporarily unreadable")
        return username

    def prepare(self, job, count: int) -> tuple[list[BrowserInstagramSession], str]:
        if count < 1:
            raise ValueError("Worker tab batch exceeds its configured capacity")
        self.ensure_capacity(bootstrap_username=job.account_username)
        sessions = self.settle_registered_tabs()
        primary = sessions[0]
        if job.kind == "digest":
            username = primary.activate_account(job.recipient_id, job.account_username)
        else:
            username = self._ready_username(primary)
        secondary_sessions = sessions[1:]
        if not secondary_sessions:
            raise BrowserSessionError(
                "No secondary Instagram tab is available for browser requests"
            )
        count = (
            len(secondary_sessions)
            if job.kind == "retrieval"
            else min(count, len(secondary_sessions))
        )
        selected = secondary_sessions[:count]
        for session in selected:
            session.reset_job_deadline(_CONTROL.job_timeout_seconds)
        # Digest requests need refreshed identity after their serialized switch.
        # Public retrievals own navigation and readiness on each assigned target.
        if job.kind == "digest":
            for session in selected:
                session.navigate(_account_profile_url(username), reload=True)
        if job.kind == "retrieval":
            # Retain only a verified public-profile bootstrap hint for repairs.
            self.queue.set_setting("retrieval_pool_account", username)
        return selected, username
