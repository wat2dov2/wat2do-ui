"""CacheEntID expansion through the one shared human-authenticated Brave session."""

from __future__ import annotations

import json
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode

from core.controlbox import controlbox
from services.instagram_notifications.browser_session import (
    _REQUEST_KEY,
    BrowserInstagramSession,
    BrowserSessionError,
    JavascriptRunner,
    _recipient_is_active_source,
)

_CONTROL = controlbox.instagram_digest
_CACHE_ID_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,255}$")
_MEDIA_KEYS = frozenset({"media_list", "media_id"})


class BrowserDigestError(BrowserSessionError):
    """A sanitized browser or Instagram digest failure."""


@dataclass(frozen=True)
class DigestResolution:
    """Media identities recovered while one intended account was active."""

    account_username: str
    media_ids: tuple[str, ...]
    page_count: int


class BrowserInstagramDigestResolver:
    """Resolve one digest while the worker owns the shared browser lock."""

    def __init__(
        self,
        *,
        session: BrowserInstagramSession | None = None,
        javascript_runner: JavascriptRunner | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
    ) -> None:
        self._session = session or BrowserInstagramSession(
            javascript_runner=javascript_runner, sleep=sleep, monotonic=monotonic
        )

    def resolve(
        self,
        intended_recipient_id: str,
        account_username: str,
        cache_ent_id: str,
    ) -> DigestResolution:
        cache_id = cache_ent_id.strip()
        if not _CACHE_ID_PATTERN.fullmatch(cache_id):
            raise BrowserDigestError("Instagram digest cache ID is invalid")
        try:
            username = self._session.activate_account(intended_recipient_id, account_username)
            payload = self._session.query(_digest_query_source(cache_id, intended_recipient_id))
        except BrowserSessionError as exc:
            raise BrowserDigestError(str(exc)) from None
        if payload.get("state") != "succeeded":
            raise BrowserDigestError(_failure_message(payload.get("reason")))
        raw_media_ids = payload.get("media_ids")
        page_count = payload.get("page_count")
        if (
            not isinstance(raw_media_ids, list)
            or isinstance(page_count, bool)
            or not isinstance(page_count, int)
            or not 1 <= page_count <= _CONTROL.maximum_pages
        ):
            raise BrowserDigestError("Instagram digest returned an invalid response")
        media_ids = tuple(_canonical_media_id(value) for value in raw_media_ids)
        if len(media_ids) != len(set(media_ids)):
            raise BrowserDigestError("Instagram digest returned duplicate media IDs")
        return DigestResolution(
            account_username=username, media_ids=media_ids, page_count=page_count
        )


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


def _digest_query_source(cache_ent_id: str, recipient_id: str) -> str:
    return f"""
(() => {{
  const requestKey = {json.dumps(_REQUEST_KEY)};
  const request = {{controller: new AbortController(), settled: false,
    result: {{state: "pending"}}}};
  window[requestKey] = request;
  (async () => {{
    try {{
      const csrf = document.cookie.split(";").map(value => value.trim())
        .find(value => value.startsWith("csrftoken="))?.slice("csrftoken=".length);
      if (!csrf) {{
        request.result = {{state: "failed", reason: "auth_required"}};
        return;
      }}
      const mediaIds = [];
      const seenMedia = new Set();
      const seenCursors = new Set();
      let maxId = null;
      for (let pageCount = 1; pageCount <= {_CONTROL.maximum_pages}; pageCount += 1) {{
        if (({_recipient_is_active_source(recipient_id)}) !== "true" ||
            request.controller.signal.aborted) {{
          request.result = {{state: "failed", reason: "account_changed"}};
          return;
        }}
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
          signal: request.controller.signal,
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
          request.result = {{state: "failed", reason: "auth_required"}};
          return;
        }}
        if (response.status === 429 || response.status >= 500) {{
          request.result = {{state: "failed", reason: "temporarily_unavailable"}};
          return;
        }}
        if (!response.ok) {{
          request.result = {{state: "failed", reason: "query_rejected"}};
          return;
        }}
        const payload = await response.json();
        if (({_recipient_is_active_source(recipient_id)}) !== "true") {{
          request.result = {{state: "failed", reason: "account_changed"}};
          return;
        }}
        const feed = payload?.data?.subscription_digest_feed;
        if (!feed || !Array.isArray(feed.items) || typeof feed.paging_info !== "object") {{
          request.result = {{state: "failed", reason: "invalid_response"}};
          return;
        }}
        for (const item of feed.items) {{
          const media = item?.media;
          const candidates = [media?.pk, media?.id]
            .filter(value => value !== undefined && value !== null)
            .map(value => String(value).split("_", 1)[0]);
          if (!candidates.length || candidates.some(value => value !== candidates[0]) ||
              !/^[1-9][0-9]{{0,31}}$/.test(candidates[0])) {{
            request.result = {{state: "failed", reason: "invalid_response"}};
            return;
          }}
          if (!seenMedia.has(candidates[0])) {{
            seenMedia.add(candidates[0]);
            mediaIds.push(candidates[0]);
          }}
        }}
        if (feed.paging_info.more_available !== true) {{
          request.result = {{
            state: "succeeded",
            media_ids: mediaIds,
            page_count: pageCount
          }};
          return;
        }}
        const nextCursor = feed.paging_info.max_id;
        if (typeof nextCursor !== "string" || !nextCursor || seenCursors.has(nextCursor)) {{
          request.result = {{state: "failed", reason: "invalid_response"}};
          return;
        }}
        seenCursors.add(nextCursor);
        maxId = nextCursor;
      }}
      request.result = {{state: "failed", reason: "page_limit"}};
    }} catch (_error) {{
      request.result = {{state: "failed", reason: "request_failed"}};
    }} finally {{
      request.settled = true;
    }}
  }})();
  return "started";
}})()
""".strip()


def _failure_message(reason: object) -> str:
    messages = {
        "account_changed": "Instagram browser account changed during the digest request",
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
