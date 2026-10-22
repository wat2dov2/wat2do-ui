"""Answer one school account's DM thread from inside the shared Brave session.

The thread is read and the reply sent by the tab's own logged-in requests, with
the active account re-checked around each one, so the browser's identity stays
the source of truth and no credential ever leaves the browser. A send whose
outcome is unknown pauses the worker for a person instead of risking a second
message.
"""

from __future__ import annotations

import json
import re
import secrets
from typing import Any

from core.controlbox import controlbox
from services.ingestion import items
from services.instagram_dms.decide import decide
from services.instagram_notifications.browser_session import (
    _REQUEST_KEY,
    BrowserEngagementUncertain,
    BrowserInstagramSession,
    BrowserSessionError,
    _current_account_username_source,
)

CONTROL = controlbox.instagram_dms
_THREAD_ID = re.compile(r"^[0-9]{1,40}$")
_API = "https://www.instagram.com/api/v1/direct_v2"


def validate_thread_id(thread_id: object) -> str:
    value = str(thread_id or "").strip()
    if not _THREAD_ID.fullmatch(value):
        raise ValueError("Instagram DM thread ID is invalid")
    return value


class BrowserInstagramDirectExecutor:
    """Read a thread, decide with the model, and act at most once per request."""

    def __init__(self, *, session: BrowserInstagramSession | None = None) -> None:
        self._session = session or BrowserInstagramSession()

    def handle(
        self,
        recipient_id: str,
        account_username: str,
        thread_id: str,
        *,
        school: str,
        school_name: str,
        dry_run: bool,
    ) -> dict[str, Any]:
        thread_id = validate_thread_id(thread_id)
        username = self._session.activate_account(recipient_id, account_username)
        thread = self._read_thread(thread_id, username)
        decision = decide(thread, account=username, school_name=school_name)
        result: dict[str, Any] = {
            "outcome": decision.outcome,
            "reason": decision.reason,
            "media_url": decision.media_url,
            "reply": decision.reply,
            "done_reply": decision.done_reply,
            "dry_run": dry_run,
        }
        if dry_run or decision.outcome == "ignore":
            return {**result, "status": "decided"}
        if decision.outcome == "story_repost":
            # Never promise a repost the app cannot make yet: no reply until the
            # emulator can share it to the school's story.
            return {**result, "status": "awaiting_story_repost"}
        # The ingestion queue deduplicates, so a post Wat2Do already has is a no-op.
        items.queue_instagram([decision.media_url], school=school)
        self._send(thread_id, username, decision.reply)
        return {**result, "status": "replied"}

    def _read_thread(self, thread_id: str, username: str) -> list[dict[str, Any]]:
        payload = self._session.query(_thread_source(thread_id, username), read_only=True)
        if payload.get("state") != "succeeded" or not isinstance(payload.get("items"), list):
            raise BrowserSessionError(f"Instagram DM thread could not be read: {_failure(payload)}")
        return payload["items"]

    def _send(self, thread_id: str, username: str, text: str) -> None:
        # The same context marks the message as one send, so Instagram itself
        # drops an accidental duplicate of this exact request.
        client_context = str(secrets.randbits(63))
        try:
            payload = self._session.query(
                _send_source(thread_id, username, text, client_context), read_only=False
            )
        except Exception:
            raise BrowserEngagementUncertain(
                "Instagram DM reply is uncertain; inspect the thread before resuming"
            ) from None
        if payload.get("state") != "succeeded":
            raise BrowserEngagementUncertain(
                f"Instagram DM reply did not confirm ({_failure(payload)}); inspect the thread before resuming"
            )


def _failure(payload: dict[str, Any]) -> str:
    """The in-tab step that failed, and Instagram's HTTP status when it answered with one."""
    reason = str(payload.get("reason") or payload.get("state") or "unknown")
    status = payload.get("http_status")
    return f"{reason} (HTTP {status})" if status else reason


def _request_source(body: str) -> str:
    """Wrap one in-tab request in the session's settle-and-cancel protocol."""
    return f"""
(() => {{
 const key = {json.dumps(_REQUEST_KEY)};
 const request = {{controller: new AbortController(), settled: false, result: {{state: "pending"}}}};
 window[key] = request;
 (async () => {{
  let reason = "request_failed";
  let httpStatus = null;
  try {{
{body}
  }} catch (_error) {{request.result = {{state: "failed", reason, http_status: httpStatus}};}}
  finally {{request.settled = true;}}
 }})();
 return "started";
}})()
""".strip()


def _account_check(username: str) -> str:
    return (
        f'   reason = "account_changed";\n'
        f"   if (({_current_account_username_source()}) !== {json.dumps(username)}) throw new Error();"
    )


def _thread_source(thread_id: str, username: str) -> str:
    """Only who sent each message, its text and any shared post leave the tab."""
    endpoint = f"{_API}/threads/{thread_id}/?limit={CONTROL.thread_item_limit}"
    return _request_source(f"""
{_account_check(username)}
   reason = "request_failed";
   const response = await fetch({json.dumps(endpoint)}, {{credentials: "include",
     signal: request.controller.signal,
     headers: {{"x-ig-app-id": {json.dumps(controlbox.scraping.instagram_web_app_id)}}}}});
   if (!response.ok) {{reason = "http_error"; httpStatus = response.status; throw new Error();}}
   reason = "invalid_json";
   const body = await response.json();
{_account_check(username)}
   reason = "invalid_thread";
   const thread = body.thread;
   if (!thread || !Array.isArray(thread.items)) throw new Error();
   const viewer = String(body.viewer_id ?? thread.viewer_id ?? "");
   const code = item => item.media_share?.code || item.clip?.clip?.code || item.felix_share?.video?.code || null;
   const items = thread.items.slice(0, {CONTROL.thread_item_limit}).map(item => ({{
     from: String(item.user_id) === viewer ? "us" : "them",
     type: String(item.item_type || ""),
     text: String(item.text || "").slice(0, 1000),
     shared_url: code(item) ? `https://www.instagram.com/p/${{code(item)}}/` : null,
   }})).reverse();
   request.result = {{state: "succeeded", items}};""")


def _send_source(thread_id: str, username: str, text: str, client_context: str) -> str:
    form = {
        "action": "send_item",
        "thread_ids": f"[{thread_id}]",
        "text": text,
        "client_context": client_context,
        "offline_threading_id": client_context,
        "mutation_token": client_context,
    }
    return _request_source(f"""
{_account_check(username)}
   reason = "missing_csrf";
   const csrf = document.cookie.split("; ")
     .find(value => value.startsWith("csrftoken="))?.slice("csrftoken=".length);
   if (!csrf) throw new Error();
   reason = "request_failed";
   const response = await fetch({json.dumps(f"{_API}/threads/broadcast/text/")}, {{method: "POST",
     credentials: "include", signal: request.controller.signal,
     headers: {{"x-ig-app-id": {json.dumps(controlbox.scraping.instagram_web_app_id)},
       "x-csrftoken": csrf, "content-type": "application/x-www-form-urlencoded"}},
     body: new URLSearchParams({json.dumps(form)}).toString()}});
   if (!response.ok) {{reason = "http_error"; httpStatus = response.status; throw new Error();}}
   reason = "invalid_json";
   const body = await response.json();
   if (body.status !== "ok") {{reason = "not_sent"; throw new Error();}}
   request.result = {{state: "succeeded"}};""")
