"""Serialized CacheEntID expansion through a human-authenticated Brave session.

The browser keeps every credential. Python sends small JavaScript operations to
one Instagram tab and receives only sanitized account names and
media IDs.
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode

from core.controlbox import controlbox
from schemas.school import validate_recipient_id

_CONTROL = controlbox.instagram_digest
_DIGEST_RESULT_KEY = "__wat2doInstagramDigestQuery"
_CACHE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,255}$")
_USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9._]{1,30}$")
_WAT2DO_ACCOUNT_PATTERN = re.compile(
    r"^(?:[a-z0-9._]+[.]wat2do[.]io|(?:[a-z0-9._]+[.])?wat2do[.]ca)$"
)
_MEDIA_KEYS = frozenset({"media_list", "media_id"})
_APPLE_SCRIPT = """
on run argv
    set javascriptSource to item 1 of argv
    if application "Brave Browser" is not running then
        error "Brave is not running."
    end if
    tell application "Brave Browser"
        repeat with browserWindow in windows
            repeat with browserTab in tabs of browserWindow
                if URL of browserTab starts with "https://www.instagram.com/" then
                    return execute browserTab javascript javascriptSource
                end if
            end repeat
        end repeat
        if (count of windows) is 0 then
            set browserWindow to make new window
            set URL of active tab of browserWindow to "https://www.instagram.com/"
        else
            tell front window
                make new tab with properties {URL:"https://www.instagram.com/"}
            end tell
        end if
        return ""
    end tell
end run
""".strip()

JavascriptRunner = Callable[[str, float], str]


class BrowserDigestError(RuntimeError):
    """A sanitized browser or Instagram digest failure."""


class _BrowserPageUnavailable(BrowserDigestError):
    """Recoverable page readiness or account-control failure."""


@dataclass(frozen=True)
class DigestResolution:
    """Media identities recovered while one intended account was active."""

    account_username: str
    media_ids: tuple[str, ...]
    page_count: int


class BrowserInstagramDigestResolver:
    """Switch one existing browser session and resolve one digest at a time."""

    def __init__(
        self,
        *,
        javascript_runner: JavascriptRunner | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._javascript_runner = javascript_runner or _execute_brave_javascript
        self._sleep = sleep
        self._monotonic = monotonic

    def resolve(
        self,
        intended_recipient_id: str,
        account_username: str,
        cache_ent_id: str,
    ) -> DigestResolution:
        """Resolve one CacheEntID without copying any browser credential."""

        try:
            recipient_id = validate_recipient_id(intended_recipient_id)
        except ValueError:
            raise BrowserDigestError("Instagram digest recipient ID is invalid") from None
        username = account_username.strip().casefold()
        if not _WAT2DO_ACCOUNT_PATTERN.fullmatch(username):
            raise BrowserDigestError("Instagram digest account username is invalid")
        cache_id = cache_ent_id.strip()
        if not _CACHE_ID_PATTERN.fullmatch(cache_id):
            raise BrowserDigestError("Instagram digest cache ID is invalid")

        try:
            self._prepare_recipient_account(recipient_id, username)
        except _BrowserPageUnavailable:
            self._run('window.location.replace("https://www.instagram.com/"); "navigating"')
            self._prepare_recipient_account(recipient_id, username)
        media_ids, page_count = self._fetch_digest(cache_id)
        return DigestResolution(
            account_username=username,
            media_ids=media_ids,
            page_count=page_count,
        )

    def _run(self, source: str) -> str:
        return self._javascript_runner(source, _CONTROL.request_timeout_seconds).strip()

    def _prepare_recipient_account(self, recipient_id: str, username: str) -> None:
        self._poll_until(lambda: self._current_account_username() is not None)
        self._activate_recipient_account(recipient_id, username)

    def _activate_recipient_account(self, recipient_id: str, username: str) -> None:
        current_username = self._current_account_username()
        if current_username != username:
            self._switch_account(username)
        if not self._recipient_is_active(recipient_id):
            raise BrowserDigestError(
                "Instagram browser account does not match the notification recipient"
            )
        self._close_account_chooser()

    def _current_account_username(self) -> str | None:
        username = self._run(_current_account_username_source())
        if not username:
            return None
        if not _USERNAME_PATTERN.fullmatch(username):
            raise BrowserDigestError("Active Instagram browser account is invalid")
        return username

    def _recipient_is_active(self, recipient_id: str) -> bool:
        return self._run(_recipient_is_active_source(recipient_id)) == "true"

    def _open_account_chooser(self) -> None:
        if self._run(_account_chooser_state_source()) == "ready":
            return
        if self._run(_switch_button_state_source()) != "ready":
            if self._run(_open_more_source()) == "missing":
                raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
            self._poll_text(_switch_button_state_source(), expected="ready")
        if self._run(_click_switch_accounts_source()) != "clicked":
            raise _BrowserPageUnavailable("Instagram account switch control is unavailable")
        self._poll_text(_account_chooser_state_source(), expected="ready")

    def _switch_account(self, username: str) -> None:
        if self._current_account_username() == username:
            return
        self._open_account_chooser()
        if self._run(_click_account_source(username)) != "clicked":
            raise BrowserDigestError("Matching Instagram browser account is unavailable")
        self._poll_until(lambda: self._current_account_username() == username)

    def _close_account_chooser(self) -> None:
        if self._run(_account_chooser_state_source()) == "ready":
            self._run(_close_account_chooser_source())

    def _fetch_digest(self, cache_ent_id: str) -> tuple[tuple[str, ...], int]:
        self._run(_digest_query_source(cache_ent_id))
        payload = self._poll_result(_DIGEST_RESULT_KEY)
        raw_media_ids = payload.get("media_ids")
        page_count = payload.get("page_count")
        if not isinstance(raw_media_ids, list) or not isinstance(page_count, int):
            raise BrowserDigestError("Instagram digest returned an invalid response")
        media_ids = tuple(_canonical_media_id(value) for value in raw_media_ids)
        if len(media_ids) != len(set(media_ids)):
            raise BrowserDigestError("Instagram digest returned duplicate media IDs")
        return media_ids, page_count

    def _poll_result(self, result_key: str) -> dict[str, Any]:
        payload: dict[str, Any] | None = None

        def completed() -> bool:
            nonlocal payload
            raw = self._run(f"JSON.stringify(window[{json.dumps(result_key)}] || null)")
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                raise BrowserDigestError(
                    "Instagram browser automation returned invalid state"
                ) from None
            if not isinstance(value, dict) or value.get("state") == "pending":
                return False
            payload = value
            return True

        try:
            self._poll_until(completed)
        finally:
            self._run(f"delete window[{json.dumps(result_key)}]; 'cleared'")
        if payload is None or payload.get("state") != "succeeded":
            reason = payload.get("reason") if payload else None
            raise BrowserDigestError(_failure_message(reason))
        return payload

    def _poll_text(self, source: str, *, expected: str) -> None:
        self._poll_until(lambda: self._run(source) == expected)

    def _poll_until(self, completed: Callable[[], bool]) -> None:
        deadline = self._monotonic() + _CONTROL.interaction_timeout_seconds
        while self._monotonic() < deadline:
            if completed():
                return
            self._sleep(_CONTROL.poll_interval_seconds)
        raise _BrowserPageUnavailable("Instagram browser automation timed out")


def action_media_ids(instagram_action: str) -> tuple[str, ...]:
    """Return canonical media IDs explicitly encoded in an Instagram action."""

    _, separator, query_string = instagram_action.partition("?")
    if not separator:
        return ()
    media_ids: dict[str, None] = {}
    for key, value in parse_qsl(query_string, keep_blank_values=True):
        if key not in _MEDIA_KEYS:
            continue
        for raw_media_id in value.split(","):
            media_ids.setdefault(_canonical_media_id(raw_media_id), None)
    return tuple(media_ids)


def digest_media_count_shortfall(
    actual_count: int,
    advertised_count: int | None,
) -> int:
    """Return the advisory shortfall while rejecting impossible over-counts."""

    if advertised_count is None:
        return 0
    if actual_count > advertised_count:
        raise BrowserDigestError("Instagram digest resolved more media IDs than advertised")
    return advertised_count - actual_count


def merge_action_media_ids(
    instagram_action: str,
    additional_media_ids: Sequence[str],
) -> str:
    """Merge resolved media into the one canonical media-list query field."""

    action_path, separator, query_string = instagram_action.partition("?")
    if not action_path or not separator:
        raise BrowserDigestError("Instagram digest action is invalid")

    query = parse_qsl(query_string, keep_blank_values=True)
    merged: dict[str, None] = {media_id: None for media_id in action_media_ids(instagram_action)}
    for raw_media_id in additional_media_ids:
        merged.setdefault(_canonical_media_id(raw_media_id), None)
    if not merged:
        raise BrowserDigestError("Instagram digest returned no media IDs")

    media_index = next(
        (index for index, (key, _value) in enumerate(query) if key in _MEDIA_KEYS),
        len(query),
    )
    remaining = [(key, value) for key, value in query if key not in _MEDIA_KEYS]
    remaining.insert(media_index, ("media_list", ",".join(merged)))
    return f"{action_path}?{urlencode(remaining)}"


def _canonical_media_id(raw_media_id: object) -> str:
    if isinstance(raw_media_id, bool) or not isinstance(raw_media_id, (str, int)):
        raise BrowserDigestError("Instagram digest returned an invalid media ID")
    media_id = str(raw_media_id).strip().split("_", 1)[0]
    if (
        not media_id.isascii()
        or not media_id.isdigit()
        or not 1 <= len(media_id) <= 32
        or media_id.startswith("0")
    ):
        raise BrowserDigestError("Instagram digest returned an invalid media ID")
    return media_id


def _execute_brave_javascript(source: str, timeout_seconds: float) -> str:
    try:
        completed = subprocess.run(
            ["/usr/bin/osascript", "-e", _APPLE_SCRIPT, "--", source],
            capture_output=True,
            text=True,
            check=True,
            timeout=timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise BrowserDigestError("AppleScript is unavailable on this host") from exc
    except subprocess.TimeoutExpired as exc:
        raise BrowserDigestError("Brave browser automation timed out") from exc
    except subprocess.CalledProcessError as exc:
        detail = f"{exc.stderr}\n{exc.stdout}"
        if "Executing JavaScript through AppleScript is turned off" in detail:
            raise BrowserDigestError(
                "Enable Brave View > Developer > Allow JavaScript from Apple Events"
            ) from None
        if "Brave is not running" in detail:
            raise BrowserDigestError("Open Brave with the logged-in Instagram accounts") from None
        raise BrowserDigestError("Brave could not run Instagram browser automation") from None
    return completed.stdout


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
  const button = [...(dialog?.querySelectorAll('button,[role="button"]') || [])]
    .find(element => (element.innerText || element.textContent || "").trim() === username);
  if (!button) return "missing";
  button.scrollIntoView({{behavior: "instant", block: "center"}});
  button.click();
  return "clicked";
}})()
""".strip()


def _current_account_username_source() -> str:
    return r"""
(() => {
  if (document.readyState !== "complete") return "";
  const anchor = [...document.querySelectorAll("a[href]")].find(candidate => {
    const image = candidate.querySelector("img[alt]");
    const alt = image?.getAttribute("alt") || "";
    const bounds = candidate.getBoundingClientRect();
    const href = candidate.getAttribute("href") || "";
    return bounds.left < 200 && alt.endsWith("'s profile picture") &&
      /^\/[A-Za-z0-9._]+\/$/.test(href);
  });
  return anchor?.getAttribute("href")?.split("/").filter(Boolean)[0] || "";
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


def _digest_query_source(cache_ent_id: str) -> str:
    return f"""
(() => {{
  const resultKey = {json.dumps(_DIGEST_RESULT_KEY)};
  window[resultKey] = {{state: "pending"}};
  (async () => {{
    try {{
      const csrf = document.cookie.split(";").map(value => value.trim())
        .find(value => value.startsWith("csrftoken="))?.slice("csrftoken=".length);
      if (!csrf) {{
        window[resultKey] = {{state: "failed", reason: "auth_required"}};
        return;
      }}
      const mediaIds = [];
      const seenMedia = new Set();
      const seenCursors = new Set();
      let maxId = null;
      for (let pageCount = 1; pageCount <= {_CONTROL.maximum_pages}; pageCount += 1) {{
        const variables = {{
          request: {{cache_ent_id: {json.dumps(cache_ent_id)}, max_id: maxId}},
          enable_audience_in_light_media: false,
          enable_clips_metadata_in_light_media: false,
          enable_likers_in_full_media: false,
          enable_thumbnails_in_light_media: false,
          enable_video_versions_in_light_media: false,
          exclude_caption_user_field: false,
          exclude_main_user_field: false,
          include_attribution_ui_data: false
        }};
        const body = new URLSearchParams({{
          signed_body: "SIGNATURE.",
          vc_policy: "default",
          locale: "en_US",
          client_doc_id: {json.dumps(_CONTROL.client_doc_id)},
          variables: JSON.stringify(variables),
          strip_nulls: "true",
          strip_defaults: "true"
        }});
        const response = await fetch({json.dumps(str(_CONTROL.endpoint_url))}, {{
          method: "POST",
          credentials: "include",
          headers: {{
            "content-type": "application/x-www-form-urlencoded",
            "x-csrftoken": csrf,
            "x-ig-app-id": {json.dumps(_CONTROL.web_app_id)},
            "x-requested-with": "XMLHttpRequest",
            "x-client-doc-id": {json.dumps(_CONTROL.client_doc_id)},
            "x-fb-friendly-name": {json.dumps(_CONTROL.operation_name)},
            "x-ig-timezone-offset": String(-new Date().getTimezoneOffset() * 60),
            "x-graphql-client-library": "minimal"
          }},
          body: body.toString()
        }});
        if (response.status === 401 || response.status === 403) {{
          window[resultKey] = {{state: "failed", reason: "auth_required"}};
          return;
        }}
        if (response.status === 429 || response.status >= 500) {{
          window[resultKey] = {{state: "failed", reason: "temporarily_unavailable"}};
          return;
        }}
        if (!response.ok) {{
          window[resultKey] = {{state: "failed", reason: "query_rejected"}};
          return;
        }}
        const payload = await response.json();
        const feed = payload?.data?.subscription_digest_feed;
        if (!feed || !Array.isArray(feed.items) || typeof feed.paging_info !== "object") {{
          window[resultKey] = {{state: "failed", reason: "invalid_response"}};
          return;
        }}
        for (const item of feed.items) {{
          const media = item?.media;
          const candidates = [media?.pk, media?.id]
            .filter(value => value !== undefined && value !== null)
            .map(value => String(value).split("_", 1)[0]);
          if (!candidates.length || candidates.some(value => value !== candidates[0]) ||
              !/^[1-9][0-9]{{0,31}}$/.test(candidates[0])) {{
            window[resultKey] = {{state: "failed", reason: "invalid_response"}};
            return;
          }}
          if (!seenMedia.has(candidates[0])) {{
            seenMedia.add(candidates[0]);
            mediaIds.push(candidates[0]);
          }}
        }}
        if (feed.paging_info.more_available !== true) {{
          window[resultKey] = {{
            state: "succeeded",
            media_ids: mediaIds,
            page_count: pageCount
          }};
          return;
        }}
        const nextCursor = feed.paging_info.max_id;
        if (typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {{
          window[resultKey] = {{state: "failed", reason: "invalid_response"}};
          return;
        }}
        seenCursors.add(nextCursor);
        maxId = nextCursor;
      }}
      window[resultKey] = {{state: "failed", reason: "page_limit"}};
    }} catch (_error) {{
      window[resultKey] = {{state: "failed", reason: "request_failed"}};
    }}
  }})();
  return "started";
}})()
""".strip()


def _failure_message(reason: object) -> str:
    messages = {
        "auth_required": "Instagram browser account requires human reauthorization",
        "account_unavailable": "Matching Instagram browser account is unavailable",
        "account_directory_failed": "Instagram browser account directory is unavailable",
        "temporarily_unavailable": "Instagram digest is temporarily unavailable",
        "query_rejected": "Instagram digest query was rejected",
        "page_limit": "Instagram digest did not reach its terminal page",
        "invalid_response": "Instagram digest returned an invalid response",
        "request_failed": "Instagram digest request failed",
    }
    return (
        messages.get(reason, "Instagram browser automation failed")
        if isinstance(reason, str)
        else "Instagram browser automation failed"
    )


__all__ = (
    "BrowserDigestError",
    "BrowserInstagramDigestResolver",
    "DigestResolution",
    "action_media_ids",
    "merge_action_media_ids",
)
