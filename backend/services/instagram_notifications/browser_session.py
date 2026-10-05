"""One existing Brave tab shared by serialized Instagram browser jobs.

Credentials remain in Brave. Account verification returns only a username and a
boolean recipient match; no cookies cross the browser boundary.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from collections.abc import Callable
from typing import Any
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
_SELECT_TAB_SCRIPT = """
on run
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindow in windows
            repeat with browserTab in tabs of browserWindow
                if URL of browserTab starts with "https://www.instagram.com/" then
                    return (id of browserTab) as text
                end if
            end repeat
        end repeat
    end tell
    error "No existing Instagram tab."
end run
""".strip()
_EXECUTE_TAB_SCRIPT = """
on run argv
    set intendedTabId to item 1 of argv
    set javascriptSource to item 2 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindow in windows
            repeat with browserTab in tabs of browserWindow
                if ((id of browserTab) as text) is intendedTabId then
                    if URL of browserTab does not start with "https://www.instagram.com/" then
                        error "Pinned Instagram tab changed site."
                    end if
                    return execute browserTab javascript javascriptSource
                end if
            end repeat
        end repeat
    end tell
    error "Pinned Instagram tab is closed."
end run
""".strip()

JavascriptRunner = Callable[[str, float], str]


class BrowserSessionError(RuntimeError):
    """A sanitized failure in the shared authenticated browser session."""


class _BrowserPageUnavailable(BrowserSessionError):
    """Recoverable page readiness or account-control failure."""


class _PinnedBraveJavascriptRunner:
    """Pin one existing tab once; never create or silently replace that tab."""

    def __init__(self) -> None:
        self._tab_id: str | None = None

    def __call__(self, source: str, timeout_seconds: float) -> str:
        if self._tab_id is None:
            tab_id = _run_applescript(_SELECT_TAB_SCRIPT, (), timeout_seconds).strip()
            if not tab_id.isascii() or not tab_id.isdigit():
                raise BrowserSessionError("Brave returned an invalid Instagram tab identity")
            self._tab_id = tab_id
        return _run_applescript(_EXECUTE_TAB_SCRIPT, (self._tab_id, source), timeout_seconds)


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
    ) -> None:
        self._javascript_runner = javascript_runner or _PinnedBraveJavascriptRunner()
        self._sleep = sleep
        self._monotonic = monotonic

    def run(self, source: str) -> str:
        return self._javascript_runner(source, _CONTROL.request_timeout_seconds).strip()

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
        try:
            self._prepare_account(recipient_id, username)
        except _BrowserPageUnavailable:
            self.run('window.location.replace("https://www.instagram.com/"); "navigating"')
            self._prepare_account(recipient_id, username)
        return username

    def verify_account(self, recipient_id: str, username: str) -> None:
        if (
            self.current_account_username() != username
            or self.run(_recipient_is_active_source(recipient_id)) != "true"
        ):
            raise BrowserSessionError(
                "Instagram browser account does not match the intended account"
            )

    def current_account_username(self) -> str | None:
        username = self.run(_current_account_username_source())
        if not username:
            return None
        if not _USERNAME_PATTERN.fullmatch(username):
            raise BrowserSessionError("Active Instagram browser account is invalid or ambiguous")
        return username.casefold()

    def navigate_post(self, post_url: str, recipient_id: str, username: str) -> str:
        canonical_url = canonical_post_url(post_url)
        self.verify_account(recipient_id, username)
        try:
            self.run(_open_post_source(canonical_url))
        except BrowserSessionError as exc:
            raise BrowserSessionError(f"Instagram post navigation failed: {exc}") from None
        try:
            self.poll_until(
                lambda: self.run(f"({_post_context_source(canonical_url)}).status") == "ready"
            )
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
        """Wait for a browser request and stop it before returning on every path."""
        self.cancel_pending_request()
        payload: dict[str, Any] | None = None

        def completed() -> bool:
            nonlocal payload
            raw = self.run(f"JSON.stringify(window[{json.dumps(_REQUEST_KEY)}]?.result || null)")
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                raise BrowserSessionError(
                    "Instagram browser returned invalid request state"
                ) from None
            if not isinstance(value, dict) or value.get("state") == "pending":
                return False
            payload = value
            return True

        try:
            self.run(source)
            self.poll_until(completed)
        finally:
            self.cancel_pending_request()
        if payload is None:
            raise BrowserSessionError("Instagram browser returned no request result")
        return payload

    def cancel_pending_request(self) -> None:
        """Abort and await settlement, including requests left by an interrupted job."""
        try:
            self.poll_until(lambda: self.run(_cancel_request_source()) == "settled")
            self.run(f"delete window[{json.dumps(_REQUEST_KEY)}]; 'cleared'")
        except BrowserSessionError as exc:
            raise BrowserSessionError(
                f"Instagram browser request cancellation could not be confirmed: {exc}"
            ) from None
        except TimeoutError:
            raise BrowserSessionError(
                "Instagram browser request cancellation could not be confirmed: "
                "the browser job deadline expired"
            ) from None

    def poll_until(self, completed: Callable[[], bool]) -> None:
        deadline = self._monotonic() + _CONTROL.interaction_timeout_seconds
        while self._monotonic() < deadline:
            if completed():
                return
            self._sleep(_CONTROL.poll_interval_seconds)
        raise _BrowserPageUnavailable("Instagram browser automation timed out")

    def _prepare_account(self, recipient_id: str, username: str) -> None:
        self.poll_until(lambda: self.current_account_username() is not None)
        if self.current_account_username() != username:
            self._switch_account(username)
        self.verify_account(recipient_id, username)
        if self.run(_account_chooser_state_source()) == "ready":
            if self.run(_close_account_chooser_source()) != "clicked":
                raise BrowserSessionError("Instagram account chooser could not be closed")

    def _open_account_chooser(self) -> None:
        if self.run(_account_chooser_state_source()) == "ready":
            return
        if self.run(_switch_button_state_source()) != "ready":
            if self.run(_open_more_source()) != "clicked":
                raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
            self.poll_until(lambda: self.run(_switch_button_state_source()) == "ready")
        if self.run(_click_switch_accounts_source()) != "clicked":
            raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
        self.poll_until(lambda: self.run(_account_chooser_state_source()) == "ready")

    def _switch_account(self, username: str) -> None:
        self._open_account_chooser()
        selected = self.run(_click_account_source(username))
        if selected == "ambiguous":
            raise BrowserSessionError("Matching Instagram browser account is ambiguous")
        if selected != "clicked":
            raise BrowserSessionError("Matching Instagram browser account is unavailable")
        self.poll_until(lambda: self.current_account_username() == username)


def school_account_username(school_slug: str) -> str:
    """Resolve the current account name from its immutable school mapping."""
    return validate_account_username(
        _CONTROL.school_username_overrides.get(school_slug, f"wat2do.{school_slug}")
    )


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


def _run_applescript(script: str, arguments: tuple[str, ...], timeout_seconds: float) -> str:
    try:
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", script, "--", *arguments],
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError:
        raise BrowserSessionError("AppleScript is unavailable on this host") from None
    except subprocess.TimeoutExpired:
        raise BrowserSessionError("Brave browser automation timed out") from None
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
        }
        for detail_match, message in messages.items():
            if detail_match in detail:
                raise BrowserSessionError(message) from None
        raise BrowserSessionError("Brave could not run Instagram browser automation") from None
    return completed.stdout


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
    return f"""
(() => {{
  const username = {json.dumps(username)};
  const heading = [...document.querySelectorAll('h1,[role="heading"]')]
    .find(element =>
      (element.innerText || element.textContent || "").trim() === "Switch accounts"
    );
  const dialog = heading?.closest('[role="dialog"]');
  const buttons = [...(dialog?.querySelectorAll('button,[role="button"]') || [])];
  const label = element => (element.innerText || element.textContent || "").trim().toLowerCase();
  const school = value => value.match(/^wat2do[.]([a-z0-9_]+)$/)?.[1] ||
    value.match(/^([a-z0-9_]+)[.]wat2do[.](?:io|ca)$/)?.[1];
  const exact = buttons.filter(element => label(element) === username);
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
  const anchors = [...document.querySelectorAll("a[href]")].filter(candidate => {
    const image = candidate.querySelector("img[alt]");
    const alt = image?.getAttribute("alt") || "";
    const bounds = candidate.getBoundingClientRect();
    const href = candidate.getAttribute("href") || "";
    return bounds.left >= 0 && bounds.left < 200 && bounds.width > 0 && bounds.height > 0 &&
      alt.endsWith("'s profile picture") &&
      /^\/[A-Za-z0-9._]+\/$/.test(href);
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
  const closeIcon = document.querySelector('[aria-label="Close"]');
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
      const codes = [...post.querySelectorAll("a[href]")]
        .filter(visible).map(anchor => shortcode(anchor.getAttribute("href"))).filter(Boolean);
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


def _open_post_source(post_url: str) -> str:
    """Reuse the current post; return before navigation unloads the script caller."""
    return rf"""
(() => {{
  const expected = new URL({json.dumps(post_url)});
  if (window.location.origin === expected.origin &&
      window.location.pathname.replace(/\/$/, "") === expected.pathname.replace(/\/$/, "")) {{
    return "already_open";
  }}
  setTimeout(() => window.location.assign(expected.href), 0);
  return "navigating";
}})()
""".strip()
