"""Read and answer one school account's DM thread in the Instagram app.

The scheduled inbox sweep opens the thread by tapping its row, and it is read from
the screen the app draws: who sent each message, its text, and any post or reel
shared in it. Claude decides the outcome and writes the reply. A message request is
accepted only once there is something to send. A story repost happens in the same app, and replies are typed into the
thread at a person's pace, each confirmed on screen before the next step. Anything
that may already have reached Instagram but cannot be confirmed pauses the worker
for a person instead of risking a second send.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from core.controlbox import controlbox
from services.ingestion import items
from services.instagram_dms.decide import DmDecision, decide
from services.instagram_emulator.device import CONTROL as EMULATOR
from services.instagram_emulator.device import (
    EmulatorDevice,
    EmulatorError,
    Node,
    labels,
)
from services.instagram_emulator.inbox import InboxRow, accept_request, open_row
from services.instagram_emulator.story import share_to_story
from services.instagram_notifications.browser_session import (
    BrowserEngagementUncertain,
    BrowserSessionError,
)

CONTROL = controlbox.instagram_dms
# Found by its view ID: its placeholder text rotates between hints like "Message…".
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
_SEND = re.compile(r"^Send$")
_SHARE = labels("Send post", "Share")
_COPY_LINK = labels("Copy link")
_POST_LINK = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)/")
_USERNAME = re.compile(r"^[a-z0-9._]{1,30}$")
# Full-width separators between messages, such as "MON 11:36 PM", "SEP 21, 5:53 PM" or
# just "11:26 PM" for today.
_TIMESTAMP = re.compile(r"^(?:(?:[A-Z]{3}|TODAY|YESTERDAY)\b.*)?\d{1,2}:\d{2}\s?[AP]M$")
# Instagram names the weekday for the last week and the date ("OCT 6, 8:26 PM") before it.
_OLDER_THAN_A_WEEK = re.compile(r"^[A-Z]{3} \d{1,2},")
# The last rows of the profile card at the top of a thread, when it is scrolled into view.
_PROFILE_CARD_END = labels("View profile", "Learn about business chats")
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
# A text message is usually an unnamed view, but one with a link preview names its text.
_TEXT_VIEW = "direct_text_message_text_view"
_SHARES_TO_READ = 2
# A sent reply can take a few screen reads to appear.
_SEND_CHECKS = 4


class EmulatorDirectExecutor:
    """Read a thread, decide with the model, and act at most once per request."""

    def __init__(self, *, device: EmulatorDevice | None = None) -> None:
        self._device = device or EmulatorDevice()

    def handle(
        self,
        row: InboxRow,
        *,
        account_username: str,
        school: str,
        school_name: str,
        dry_run: bool,
    ) -> dict[str, Any]:
        """Answer the inbox row's thread; the caller holds the emulator lock on this account."""
        user = EMULATOR.android_user_by_school[school]
        reader = _ThreadReader(self._device, lambda: open_row(self._device, user, row.name))
        try:
            thread = reader.read()
        except EmulatorError as exc:
            raise BrowserSessionError(f"Instagram DM thread could not be read: {exc}") from None
        decision = (
            DmDecision("ignore", reason="Newest message is over a week old")
            if reader.stale
            else decide(thread, account=account_username, school=school, school_name=school_name)
        )
        result: dict[str, Any] = {
            "outcome": decision.outcome,
            "reason": decision.reason,
            "media_url": decision.media_url,
            "reply": decision.reply,
            "dry_run": dry_run,
        }
        if dry_run or decision.outcome == "ignore":
            # A request we do not answer stays unaccepted, so its sender never sees it read.
            return {**result, "status": "decided"}
        if (
            decision.outcome == "story_repost"
            and self._device.reclaim_data() < EMULATOR.min_free_data_megabytes
        ):
            # A story upload can fail halfway on a full device; wait for space instead.
            raise BrowserSessionError("The emulator is low on storage; story reposts wait")
        if row.request:
            _confirmed("request accept", lambda: accept_request(self._device))
        if decision.outcome == "story_repost":
            # Never promise a repost that might fail: reply only once it is posted.
            _confirmed(
                "story repost",
                lambda: share_to_story(school, account_username, decision.media_url),
            )
            _confirmed("reply", lambda: reader.send(decision.reply))
            return {**result, "status": "reposted"}
        if decision.outcome == "add_to_post":
            # The ingestion queue deduplicates, so a post Wat2Do already has is a no-op.
            items.queue_instagram([decision.media_url], school=school)
        _confirmed("reply", lambda: reader.send(decision.reply))
        return {**result, "status": "replied"}


def _confirmed(action: str, step: Any) -> None:
    try:
        step()
    except Exception:
        # Even a failure may have reached Instagram, so a person checks before any retry.
        raise BrowserEngagementUncertain(
            f"Instagram DM {action} is uncertain; inspect the thread and story before resuming"
        ) from None


class _ThreadReader:
    def __init__(self, device: EmulatorDevice, opener: Callable[[], None]) -> None:
        self._device = device
        # Brings the thread back on screen, e.g. after a story repost leaves it.
        self._opener = opener
        # Whether the newest dated message on screen is over a week old; set by read.
        self.stale = False

    def read(self) -> list[dict[str, Any]]:
        """The thread's visible messages, oldest first, with each shared post's link."""
        nodes = self._open()
        self.stale = _newest_message_is_old(nodes)
        sender = _sender(nodes)
        messages = _messages(nodes)[-CONTROL.thread_item_limit :]
        # When our message is the newest there is nothing to answer, so no link is needed.
        if messages and messages[-1]["from"] == "them":
            # A request is about the post just shared, so only the newest few need a link.
            shares = _their_shares(messages)[-_SHARES_TO_READ:]
            for from_bottom, message in enumerate(reversed(shares)):
                message["shared_url"] = self._shared_link(from_bottom, message["shared_owner"])
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
        self._device.tap(_required(self._device.find(_COMPOSER, nodes)))
        self._device.type_text(text)
        self._device.tap_when(_SEND)
        # The thread scrolls as the reply lands and older messages leave the screen, so
        # the reply is confirmed by being the newest message, not by a count.
        for _ in range(_SEND_CHECKS):
            self._device.pause()
            if _newest_is_ours(self._screen_in_thread(), text):
                return
        raise EmulatorError("The reply did not appear in the thread")

    def _open(self) -> list[Node]:
        self._opener()
        return self._device.screen()

    def _screen_in_thread(self) -> list[Node]:
        nodes = self._device.screen()
        in_thread = any(node.resource_id == "message_list" for node in nodes)
        return nodes if in_thread else self._open()

    def _shared_link(self, from_bottom: int, owner: str | None) -> str | None:
        """Copy the shared post's link, then read it back through the thread's composer.

        The post is found again counting from the newest share, since a share cut off at
        the top of the screen can come and go as the thread settles.
        """
        nodes = self._screen_in_thread()
        shares = _their_shares(_messages(nodes))
        if from_bottom >= len(shares) or shares[-1 - from_bottom]["shared_owner"] != owner:
            raise EmulatorError("The DM thread changed while it was being read")
        message = shares[-1 - from_bottom]
        # A reel drawn as a bare card is shared through the Forward button beside it, whose
        # sheet has Copy link; a post bubble's own sheet does not, so it is opened instead.
        forward = _forward_button(nodes, message["media"]) if message["card"] else None
        self._device.tap(forward or message["media"])
        try:
            if forward is None:
                self._device.tap_when(_SHARE)
            self._device.tap_when(_COPY_LINK)
        except EmulatorError:
            # Deleted or private posts have no link to copy.
            self._device.back()
            return None
        self._device.back()
        self._screen_in_thread()
        # The link is read back through the composer, which a request shows only once
        # accepted; a club that shares its post is almost always asking us to share it.
        accept_request(self._device)
        self._device.tap(_required(self._device.find(_COMPOSER)))
        self._device.paste()
        self._device.pause()
        pasted = _required(self._device.find(_COMPOSER)).text
        self._device.clear_field()
        # The keyboard shrinks the thread and hides older messages; put it away.
        self._device.back()
        match = _POST_LINK.match(pasted)
        return f"https://www.instagram.com/p/{match.group(1)}/" if match else None


def _their_shares(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Their shared posts whose owner is readable; one cut off at the top has no owner on
    screen, and a post with no owner can never be acted on."""
    return [
        m
        for m in messages
        if m["from"] == "them" and m["type"] == "media_share" and m["shared_owner"]
    ]


def _forward_button(nodes: list[Node], media: Node) -> Node | None:
    return next(
        (
            node
            for node in nodes
            if node.resource_id == "forwarding_shortcut_button"
            and media.bounds[1] <= node.bounds[1] <= media.bounds[3]
        ),
        None,
    )


def _required(node: Node | None) -> Node:
    if node is None:
        raise EmulatorError("The DM thread is not on screen")
    return node


def _sender(nodes: list[Node]) -> str | None:
    """The other person's username, from the header of a one-to-one thread."""
    title = next((node.label for node in nodes if node.resource_id == "header_title"), "")
    subtitle = next((node.label for node in nodes if node.resource_id == "header_subtitle"), "")
    # While they are online the subtitle says "Active now"; their avatar still names them.
    avatar = next((node.label for node in nodes if node.resource_id == "header_avatar"), "")
    for candidate in (subtitle, title, avatar.removeprefix("Open story of ")):
        if _USERNAME.fullmatch(candidate):
            return candidate
    return None


def _messages(nodes: list[Node]) -> list[dict[str, Any]]:
    """Every message bubble on screen, top to bottom."""
    message_list = next((node for node in nodes if node.resource_id == "message_list"), None)
    if message_list is None:
        raise EmulatorError("The DM thread is not on screen")
    inside = [node for node in nodes if node.inside(message_list)]
    # The profile card sits above the first message until the thread scrolls past it.
    top = max(
        (node.bounds[3] for node in inside if node.labelled(_PROFILE_CARD_END)),
        default=message_list.bounds[1],
    )
    separators = [node for node in inside if _is_separator(node, message_list)]
    bubbles = [node for node in inside if node.resource_id == "xma_bubble_container"]
    # A shared reel can also be drawn as a bare media card, its owner above the video.
    cards = [
        node
        for node in inside
        if node.resource_id == "media_container"
        and not any(node.inside(bubble) for bubble in bubbles)
    ]
    found: list[tuple[int, dict[str, Any]]] = []
    for bubble in bubbles:
        if bubble.bounds[1] < top:
            continue
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
                    "card": False,
                },
            )
        )
    for card in cards:
        if card.bounds[1] < top:
            continue
        owner = next(
            (
                node.text
                for node in inside
                if node.inside(card) and node.resource_id == "title_text"
            ),
            "",
        )
        found.append(
            (
                card.bounds[1],
                {
                    "from": _side(card),
                    "type": "media_share",
                    "text": "",
                    "shared_url": None,
                    "shared_owner": owner if _USERNAME.fullmatch(owner) else None,
                    "media": card,
                    "card": True,
                },
            )
        )
    for node in inside:
        if (
            node.resource_id not in ("", _TEXT_VIEW)
            or not node.text
            or node.bounds[1] < top
            or node in separators
            or _NOT_A_MESSAGE.match(node.text)
            or any(node.inside(container) for container in [*bubbles, *cards])
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
                    "card": False,
                },
            )
        )
    return [message for _top, message in sorted(found, key=lambda pair: pair[0])]


def _newest_message_is_old(nodes: list[Node]) -> bool:
    message_list = next((node for node in nodes if node.resource_id == "message_list"), None)
    if message_list is None:
        return False
    separators = [node for node in nodes if _is_separator(node, message_list)]
    newest = max(separators, key=lambda node: node.bounds[1], default=None)
    return newest is not None and bool(_OLDER_THAN_A_WEEK.match(newest.text))


def _is_separator(node: Node, message_list: Node) -> bool:
    spans_list = (
        node.bounds[0] == message_list.bounds[0] and node.bounds[2] == message_list.bounds[2]
    )
    return spans_list and bool(_TIMESTAMP.match(node.text))


def _side(node: Node) -> str:
    return "them" if node.bounds[0] < _THEIR_BUBBLE_MAX_LEFT else "us"


def _newest_is_ours(nodes: list[Node], text: str) -> bool:
    messages = _messages(nodes)
    return bool(messages) and (messages[-1]["from"], messages[-1]["text"]) == ("us", text)
