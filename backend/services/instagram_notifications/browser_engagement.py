"""Idempotent native actions on one post using the shared Brave session.

Only visible, unambiguous controls are used. Missing native repost state is an
unsupported capability, never an excuse to guess whether clicking would undo it.
"""

from __future__ import annotations

import json

from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserInstagramSession,
    BrowserSessionError,
    _current_account_username_source,
    _post_context_source,
    _recipient_is_active_source,
    canonical_post_url,
)

_ACTIONS = frozenset({"like", "save", "repost"})


# Observed native toolbar glyphs: Instagram preserves the Repost label in both states.
# Without explicit state, unknown glyphs remain unsupported instead of risking a toggle.
_REPOST_INACTIVE_PATH = "M19.998 9.497a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27h-5.313l1.791-1.787a1 1 0 0 0-1.412-1.416L7.29 18.287a1.004 1.004 0 0 0-.294.707v.001c0 .023.012.042.013.065a.923.923 0 0 0 .281.643l3.502 3.504a1 1 0 0 0 1.414-1.414l-1.797-1.798h5.318a5.276 5.276 0 0 0 5.27-5.27v-4.228a1 1 0 0 0-1-1Zm-6.41-3.496-1.795 1.795a1 1 0 1 0 1.414 1.414l3.5-3.5a1.003 1.003 0 0 0 0-1.417l-3.5-3.5a1 1 0 0 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 0 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27Z"
_REPOST_ACTIVE_PATH = "M16 6.001a1 1 0 0 0 .924-1.382.998.998 0 0 0-.217-.326l-3.5-3.5a1 1 0 1 0-1.414 1.414l1.794 1.794H8.27A5.277 5.277 0 0 0 3 9.271V13.5a1 1 0 1 0 2 0V9.271a3.275 3.275 0 0 1 3.271-3.27h7.73Zm3.998 3.496a1 1 0 0 0-1 1v4.228a3.274 3.274 0 0 1-3.27 3.27H7.996a1.001 1.001 0 0 0-.706 1.708l3.502 3.504a.997.997 0 0 0 1.414 0 1 1 0 0 0 0-1.414l-1.797-1.798h5.317a5.276 5.276 0 0 0 5.271-5.27v-4.228a1 1 0 0 0-1-1Zm-5.205-.51-3.905 3.906-1.681-1.681a1 1 0 1 0-1.414 1.414l2.388 2.388a1 1 0 0 0 1.414 0l4.612-4.614a1 1 0 1 0-1.414-1.414Z"


class BrowserInstagramEngagementExecutor:
    """Complete one post per worker lock, verifying identity before any click."""

    def __init__(self, *, session: BrowserInstagramSession | None = None) -> None:
        self._session = session or BrowserInstagramSession()

    def engage_post(
        self, recipient_id: str, account_username: str, post_url: str, *, inspect: bool = False
    ) -> dict:
        """Open once and finish configured actions before releasing this post's lock."""
        from core.controlbox import controlbox

        username, url = self._prepare(recipient_id, account_username, post_url)
        actions = {}
        for action in controlbox.instagram_browser.actions:
            state = (
                self._ready(recipient_id, username, url, action)
                if inspect
                else self._state(recipient_id, username, url, action, click=True)
            )
            actions[action] = (
                state if inspect else self._complete(recipient_id, username, url, action, state)
            )
        status = (
            "unsupported"
            if any(result["status"] == "unsupported" for result in actions.values())
            else "ready"
            if inspect
            else "succeeded"
        )
        return {"status": status, "actions": actions}

    def _complete(
        self, recipient_id: str, username: str, url: str, action: str, result: dict[str, str]
    ) -> dict[str, str]:
        if result["status"] != "clicked":
            return result

        def completed() -> bool:
            state = self._state(recipient_id, username, url, action, click=False)
            if state["status"] == "already_done":
                return True
            if state["status"] == "unsupported":
                raise BrowserSessionError(
                    "Instagram action state became unavailable after clicking"
                )
            return False

        # Never click a second time. An uncertain completion requires inspection
        # on a manual retry, which can recognize an already completed action.
        try:
            self._session.poll_until(completed)
        except Exception:
            raise BrowserEngagementUncertain(
                "Instagram engagement completion is uncertain; inspect browser state before resuming"
            ) from None
        return {"action": action, "status": "succeeded"}

    def _prepare(self, recipient_id: str, account_username: str, post_url: str) -> tuple[str, str]:
        url = canonical_post_url(post_url)
        username = self._session.activate_account(recipient_id, account_username)
        self._session.navigate_post(url, recipient_id, username)
        return username, url

    def _state(
        self, recipient_id: str, username: str, post_url: str, action: str, *, click: bool
    ) -> dict[str, str]:
        if action not in _ACTIONS:
            raise BrowserSessionError("Instagram engagement action is invalid")
        if click:
            ready = self._ready(recipient_id, username, post_url, action)
            if ready["status"] != "ready":
                return ready
        source = _engagement_source(recipient_id, username, post_url, action, click=click)
        if click:
            try:
                raw = self._session.run(source)
            except Exception:
                raise BrowserEngagementUncertain(
                    "Instagram engagement dispatch is uncertain; inspect browser state before resuming"
                ) from None
        else:
            raw = self._session.read(source)
        response_error = BrowserEngagementUncertain if click else BrowserSessionError
        invalid_state_message = (
            "Instagram engagement dispatch is uncertain; inspect browser state before resuming"
            if click
            else "Instagram engagement returned invalid state"
        )
        try:
            state = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            raise response_error(invalid_state_message) from None
        if not isinstance(state, dict):
            raise response_error(invalid_state_message)
        status = state.get("status")
        if status == "failed":
            raise BrowserSessionError(_failure_message(state.get("reason")))
        if not isinstance(status, str) or status not in {
            "ready",
            "not_ready",
            "clicked",
            "already_done",
            "unsupported",
        }:
            raise response_error(invalid_state_message)
        if status == "ready" and click:
            raise BrowserEngagementUncertain(invalid_state_message)
        if status == "not_ready" and click:
            raise BrowserSessionError(_failure_message("not_ready"))
        if status == "clicked" and not click:
            raise BrowserSessionError("Instagram engagement returned invalid state")
        result = {"action": action, "status": status}
        if status == "unsupported":
            result["reason"] = "Native repost is unavailable or has no explicit reversible state"
        return result

    def _ready(
        self, recipient_id: str, username: str, post_url: str, action: str
    ) -> dict[str, str]:
        state: dict[str, str] = {}

        def enabled() -> bool:
            nonlocal state
            state = self._state(recipient_id, username, post_url, action, click=False)
            return state["status"] != "not_ready"

        self._session.poll_until(enabled)
        return state


def _failure_message(reason: object) -> str:
    return {
        "wrong_account": "Instagram browser account does not match the intended account",
        "wrong_post": "Instagram browser is not on the intended post",
        "not_ready": "Instagram post is not ready for engagement",
        "ambiguous_post": "Instagram post container is unavailable or ambiguous",
        "ambiguous_toolbar": "Instagram post action toolbar is unavailable or ambiguous",
        "ambiguous_control": "Instagram post action control is unavailable or ambiguous",
        "unknown_state": "Instagram post action state is unknown",
        "blocked": "Instagram browser requires human attention before engagement",
    }.get(reason if isinstance(reason, str) else "", "Instagram engagement failed")


def _engagement_source(
    recipient_id: str, username: str, post_url: str, action: str, *, click: bool
) -> str:
    """Inspect and optionally click in one turn, so no stale DOM handle can act."""
    return f"""
(() => {{
  const fail = reason => JSON.stringify({{status: "failed", reason}});
  const result = status => JSON.stringify({{status}});
  const context = {_post_context_source(post_url)};
  if (context.status !== "ready") return fail(context.reason);
  if (({_current_account_username_source()}) !== {json.dumps(username)} ||
      ({_recipient_is_active_source(recipient_id)}) !== "true") return fail("wrong_account");
  const {{toolbar, visible, labels}} = context;
  const action = {json.dumps(action)};
  const names = {{like: ["Like", "Unlike"], save: ["Save", "Remove", "Unsave"],
    repost: ["Repost", "Undo repost", "Remove repost"]}}[action];
  const controls = [...new Set([...toolbar.querySelectorAll("[aria-label]")]
    .filter(node => names.includes(node.getAttribute("aria-label")) && visible(node))
    .map(node => node.closest('button,[role="button"]')).filter(Boolean))];
  if (!controls.length && action === "repost") return result("unsupported");
  if (controls.length !== 1 || !visible(controls[0])) return fail("ambiguous_control");
  const control = controls[0];
  if (control.getAttribute("aria-disabled") === "true" || control.disabled) return result("not_ready");
  const actionLabels = [...new Set(labels(control).filter(name => names.includes(name)))];
  if (actionLabels.length !== 1) return fail("unknown_state");
  const label = actionLabels[0];
  const pressed = control.getAttribute("aria-pressed");
  let done = label !== names[0];
  if (action === "repost" && label === "Repost") {{
    if (pressed !== null && pressed !== "true" && pressed !== "false") return fail("unknown_state");
    const paths = [...(control.querySelector('svg[aria-label="Repost"]')?.querySelectorAll('path') || [])];
    const glyph = paths.length === 1 ? paths[0].getAttribute("d") : null;
    const glyphDone = glyph === {json.dumps(_REPOST_ACTIVE_PATH)} ? true :
      glyph === {json.dumps(_REPOST_INACTIVE_PATH)} ? false : null;
    if (pressed === "true" || pressed === "false") {{
      done = pressed === "true";
      if (glyphDone !== null && glyphDone !== done) return fail("unknown_state");
    }} else {{
      if (glyphDone === null) return result("unsupported");
      done = glyphDone;
    }}
  }} else if (pressed !== null && pressed !== String(done)) {{
    return fail("unknown_state");
  }}
  if (done) return result("already_done");
  if (!{str(click).lower()}) return result("ready");
  control.scrollIntoView({{behavior: "instant", block: "center"}});
  control.click();
  return result("clicked");
}})()
""".strip()
