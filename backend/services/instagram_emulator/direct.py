"""Read and answer one school account's DM thread in the Instagram app.

The thread is opened by its ID and read from the screen the app draws: who sent each
message, its text, and any post or reel shared in it. Claude Haiku decides the
outcome. A story repost happens in the same app, and replies are typed into the
thread at a person's pace, each confirmed on screen before the next step. Anything
that may already have reached Instagram but cannot be confirmed pauses the worker
for a person instead of risking a second send.
"""

from __future__ import annotations

import random
import re
import time
from typing import Any

from core.controlbox import controlbox
from services.ingestion import items
from services.instagram_dms.decide import decide
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import (
    EmulatorDevice,
    EmulatorError,
    Node,
    exclusive,
    labels,
)
from services.instagram_emulator.story import share_to_story
from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserSessionError,
)

CONTROL = controlbox.instagram_dms
_THREAD_ID = re.compile(r"^[0-9]{1,40}$")
# Found by its view ID: its placeholder text rotates between hints like "Message…".
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
_SEND = re.compile(r"^Send$")
_SHARE = labels("Send post", "Share")
_COPY_LINK = labels("Copy link")
_POST_LINK = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)/")
_USERNAME = re.compile(r"^[a-z0-9._]{1,30}$")
# Day-and-time separators between messages, such as "MON 11:36 PM" or "SEP 21, 5:53 PM".
_TIMESTAMP = re.compile(r"^(?:[A-Z]{3}|TODAY|YESTERDAY)\b.*\d{1,2}:\d{2}")
_NOT_A_MESSAGE = labels(
    "Tap and hold to react",
    "Seen",
    "Sent",
    "Delivered",
    "View profile",
    "Learn about business chats",
    "Swipe up to turn on",
)
# Their bubbles start right after the avatar column; ours sit against the right edge.
_THEIR_BUBBLE_MAX_LEFT = 240


def validate_thread_id(thread_id: object) -> str:
    value = str(thread_id or "").strip()
    if not _THREAD_ID.fullmatch(value):
        raise ValueError("Instagram DM thread ID is invalid")
    return value


class EmulatorDirectExecutor:
    """Read a thread, decide with the model, and act at most once per request."""

    def __init__(self, *, device: EmulatorDevice | None = None) -> None:
        self._device = device or EmulatorDevice()

    def handle(
        self,
        account_username: str,
        thread_id: str,
        *,
        school: str,
        school_name: str,
        dry_run: bool,
    ) -> dict[str, Any]:
        thread_id = validate_thread_id(thread_id)
        user = EMULATOR.android_user_by_school.get(school)
        if user is None:
            raise BrowserSessionError("This school's account is not logged in on the emulator")
        with exclusive():
            try:
                self._device.wake()
                self._device.use_android_user(user)
                self._device.use_account(user, account_username)
                thread = _ThreadReader(self._device, user, thread_id).read()
            except EmulatorError as exc:
                raise BrowserSessionError(f"Instagram DM thread could not be read: {exc}") from None
            decision = decide(
                thread, account=account_username, school=school, school_name=school_name
            )
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
                # Never promise a repost that might fail: reply only once it is posted.
                _confirmed(
                    "story repost",
                    lambda: share_to_story(school, account_username, decision.media_url),
                )
                self._reply(user, thread_id, decision.reply)
                time.sleep(
                    random.uniform(
                        CONTROL.done_reply_delay_min_seconds, CONTROL.done_reply_delay_max_seconds
                    )
                )
                self._reply(user, thread_id, decision.done_reply)
                return {**result, "status": "reposted"}
            # The ingestion queue deduplicates, so a post Wat2Do already has is a no-op.
            items.queue_instagram([decision.media_url], school=school)
            self._reply(user, thread_id, decision.reply)
            return {**result, "status": "replied"}

    def _reply(self, user: int, thread_id: str, text: str) -> None:
        _confirmed("reply", lambda: _ThreadReader(self._device, user, thread_id).send(text))


def _confirmed(action: str, step: Any) -> None:
    try:
        step()
    except Exception:
        # Even a failure may have reached Instagram, so a person checks before any retry.
        raise BrowserEngagementUncertain(
            f"Instagram DM {action} is uncertain; inspect the thread and story before resuming"
        ) from None


class _ThreadReader:
    def __init__(self, device: EmulatorDevice, user: int, thread_id: str) -> None:
        self._device = device
        self._user = user
        self._thread_id = thread_id

    def read(self) -> list[dict[str, Any]]:
        """The thread's visible messages, oldest first, with each shared post's link."""
        nodes = self._open()
        sender = _sender(nodes)
        messages = _messages(nodes)[-CONTROL.thread_item_limit :]
        for index, message in enumerate(messages):
            if message["from"] == "them" and message["type"] == "media_share":
                message["shared_url"] = self._shared_link(index, message["shared_owner"])
        return [
            {
                "from": message["from"],
                "type": message["type"],
                "text": message["text"][:1000],
                "shared_url": message["shared_url"],
                "sender": sender if message["from"] == "them" else None,
                "shared_owner": message["shared_owner"],
            }
            for message in messages
        ]

    def send(self, text: str) -> None:
        nodes = self._screen_in_thread()
        before = _our_texts(nodes)
        self._device.tap(_required(self._device.find(_COMPOSER, nodes)))
        self._device.type_text(text)
        self._device.tap_when(_SEND)
        self._device.pause()
        after = _our_texts(self._screen_in_thread())
        if len(after) <= len(before) or after[-1] != text:
            raise EmulatorError("The reply did not appear in the thread")

    def _open(self) -> list[Node]:
        self._device.open_instagram(
            self._user, f"instagram://direct-thread?thread_id={self._thread_id}"
        )
        self._device.wait_for(_COMPOSER)
        self._device.pause()
        return self._device.screen()

    def _screen_in_thread(self) -> list[Node]:
        nodes = self._device.screen()
        return nodes if self._device.find(_COMPOSER, nodes) is not None else self._open()

    def _shared_link(self, index: int, owner: str | None) -> str | None:
        """Copy the shared post's link, then read it back through the thread's composer."""
        nodes = self._screen_in_thread()
        message = _messages(nodes)[-CONTROL.thread_item_limit :][index]
        if message["type"] != "media_share" or message["shared_owner"] != owner:
            raise EmulatorError("The DM thread changed while it was being read")
        self._device.tap(message["media"])
        try:
            self._device.tap_when(_SHARE)
            self._device.tap_when(_COPY_LINK)
        except EmulatorError:
            # Deleted or private posts have no link to copy.
            self._device.back()
            return None
        self._device.back()
        nodes = self._screen_in_thread()
        self._device.tap(_required(self._device.find(_COMPOSER, nodes)))
        self._device.paste()
        self._device.pause()
        pasted = _required(self._device.find(_COMPOSER)).text
        self._device.clear_field()
        match = _POST_LINK.match(pasted)
        return f"https://www.instagram.com/p/{match.group(1)}/" if match else None


def _required(node: Node | None) -> Node:
    if node is None:
        raise EmulatorError("The DM thread is not on screen")
    return node


def _sender(nodes: list[Node]) -> str | None:
    """The other person's username, from the header of a one-to-one thread."""
    title = next((node.label for node in nodes if node.resource_id == "header_title"), "")
    subtitle = next((node.label for node in nodes if node.resource_id == "header_subtitle"), "")
    for candidate in (subtitle, title):
        if _USERNAME.fullmatch(candidate):
            return candidate
    return None


def _messages(nodes: list[Node]) -> list[dict[str, Any]]:
    """Every message bubble on screen, top to bottom."""
    message_list = next((node for node in nodes if node.resource_id == "message_list"), None)
    if message_list is None:
        raise EmulatorError("The DM thread is not on screen")
    inside = [node for node in nodes if node.inside(message_list)]
    # Everything above the first day-and-time separator is the thread's profile header.
    first_separator = min(
        (node.bounds[1] for node in inside if _TIMESTAMP.match(node.text)), default=None
    )
    if first_separator is None:
        return []
    bubbles = [node for node in inside if node.resource_id == "xma_bubble_container"]
    found: list[tuple[int, dict[str, Any]]] = []
    for bubble in bubbles:
        parts = [node for node in inside if node.inside(bubble)]
        owner = next((node.text for node in parts if node.resource_id == "title"), "")
        caption = next((node.text for node in parts if node.resource_id == "caption_title"), "")
        media = next((node for node in parts if node.resource_id == "media_container"), bubble)
        found.append(
            (
                bubble.bounds[1],
                {
                    "from": _side(bubble),
                    "type": "media_share",
                    "text": caption.removeprefix(owner).strip(),
                    "shared_url": None,
                    "shared_owner": owner if _USERNAME.fullmatch(owner) else None,
                    "media": media,
                },
            )
        )
    for node in inside:
        if (
            node.resource_id
            or not node.text
            or node.bounds[1] < first_separator
            or _TIMESTAMP.match(node.text)
            or _NOT_A_MESSAGE.match(node.text)
            or any(node.inside(bubble) for bubble in bubbles)
        ):
            continue
        found.append(
            (
                node.bounds[1],
                {
                    "from": _side(node),
                    "type": "text",
                    "text": node.text,
                    "shared_url": None,
                    "shared_owner": None,
                    "media": None,
                },
            )
        )
    return [message for _top, message in sorted(found, key=lambda pair: pair[0])]


def _side(node: Node) -> str:
    return "them" if node.bounds[0] < _THEIR_BUBBLE_MAX_LEFT else "us"


def _our_texts(nodes: list[Node]) -> list[str]:
    return [
        message["text"]
        for message in _messages(nodes)
        if message["from"] == "us" and message["type"] == "text"
    ]
