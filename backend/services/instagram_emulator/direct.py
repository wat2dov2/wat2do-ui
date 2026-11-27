"""Read one school account's DM thread in the Instagram app, and answer in it.

A sitting's moves (``services/instagram_sessions/moves.py``) open a thread by tapping
its inbox row and read it from the screen the app draws: who sent each message, its
text, and any post or reel shared in it. The notification agent's
moves send a short reply, react with a heart, accept a request or send the claim-link
message to a club that asked us to feature it (Tony, 2026-11-24), each typed or tapped
at a person's pace.

Every move works on the thread it names and no other: the thread is opened from its
inbox row each time and its header must name it before anything is read or typed
(2026-11-25: claim messages went into whatever thread an earlier read had left open).

A French-language school's account (``schools.language``) never sends a DM (Tony,
2026-11-26): every send here refuses with ``NoDms`` before the thread is even opened.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

from core.controlbox import controlbox
from core.database import get_sb
from core.tables import INSTAGRAM_EXCLUDED_CLUBS
from services import school_service
from services.instagram_emulator.device import (
    EmulatorDevice,
    EmulatorError,
    Node,
    labels,
)
from services.instagram_emulator.inbox import accept_request, raise_if_messaging_limited

CONTROL = controlbox.instagram_dms
# Found by its view ID: its placeholder text rotates between hints like "Message…".
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
# The composer's send button, which shows once the composer holds text.
_SEND_BUTTON = re.compile(r"^row_thread_composer_send_button_container$")
# An empty composer reads as a short rotating hint, such as "Message…".
_COMPOSER_HINT = re.compile(r"^[^.!?\n]{1,40}…$")
# A draft that is nothing but Instagram post links, run together.
_JUNK_DRAFT = re.compile(r"(?:https://www\.instagram\.com/(?:p|reel)/[A-Za-z0-9_-]+/\S*?)+")
# A club's claim link, which carries its claim token.
CLAIM_LINK = re.compile(r"https?://[a-z0-9-]+\.wat2do\.io/claim/([0-9a-f-]+)\S*", re.IGNORECASE)
# A message asking us to stop featuring them, to ask first or not to track them, in
# English or French.
_OPT_OUT = re.compile(
    r"\b(?:stop|quit)\s+(?:post|shar|repost|featur|includ|promot|tagg)"
    r"|\b(?:don['’]?t|do not|no longer|not)\s+(?:to\s+)?(?:be\s+)?"
    r"(?:post|shar|repost|featur|includ|promot|tag)"
    r"|\bremove\s+(?:us|our)\b|\btake\s+(?:us|it|them|this|these|our\s+\w+)\s+(?:down|off)\b"
    r"|\bleave\s+us\s+out\b|\bopt(?:ing)?[\s-]?out\b|\bunsubscribe\b"
    r"|\bne\s+(?:pas|plus)\s+(?:nous\s+)?(?:publier|partager|republier|mettre)"
    r"|\b(?:arr[eê]te[rz]?|cessez)\s+de\s+(?:publier|partager|republier)"
    r"|\b(?:retire[rz]?|enlever|enlevez)\s+(?:nous|notre|nos)\b"
    r"|\bask\s+(?:us\s+)?(?:first|before)\b|\bcheck\s+with\s+us\s+(?:first|before)\b"
    r"|\bwithout\s+(?:our\s+|asking\s+|any\s+)?(?:permission|consent)\b"
    r"|\b(?:be\s+tracked|track(?:ing)?\s+us)\b"
    r"|\bsans\s+(?:notre\s+)?(?:permission|accord|autorisation)\b",
    re.IGNORECASE,
)
_SHARE = labels("Send post", "Share")
_COPY_LINK = labels("Copy link")
_POST_LINK = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/([A-Za-z0-9_-]+)/")
_USERNAME = re.compile(r"^[a-z0-9._]{1,30}$")
# Tapping the thread's header opens its details, whose Profile shortcut opens their profile.
_HEADER_TITLE = re.compile(r"^header_title$")
_PROFILE_SHORTCUT = re.compile(r"^Profile$")
_PROFILE_USERNAME = re.compile(r"^action_bar_title$")
# Full-width separators between messages, such as "MON 11:36 PM", "SEP 21, 5:53 PM" or
# just "11:26 PM" for today.
_TIMESTAMP = re.compile(r"^(?:(?:[A-Z]{3}|TODAY|YESTERDAY)\b.*)?\d{1,2}:\d{2}\s?[AP]M$")
# Instagram names the weekday for the last week and the date ("OCT 6, 8:26 PM") before it.
_OLDER_THAN_A_WEEK = re.compile(r"^[A-Z]{3} \d{1,2},")
# The last rows of the profile card at the top of a thread, when it is scrolled into view.
_PROFILE_CARD_END = labels("View profile", "Learn about business chats")
_NOT_A_MESSAGE = labels(
    # Hints under a message, such as "to react" or "to imagine with AI. Try it".
    "Tap and hold to",
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
# A reaction shows as a small emoji pill under its message, about 47 px square.
_REACTION_PILL_MAX = 120
_REACTION_WAIT_SECONDS = 5
# Upward swipes allowed to bring a share cut off at the top of the thread fully on screen.
_REVEAL_SCROLLS = 4


class ReplyWaiting(EmulatorError):
    """The thread holds an unsent reply of ours (no claim link) that a person has yet to send."""


class NoDms(EmulatorError):
    """The account is a French-language school's, so nothing was typed or sent."""


class ThreadMismatch(EmulatorError):
    """The thread on screen is not the one asked for, so nothing was typed or sent in it."""


class LeftOut(EmulatorError):
    """The thread's club asked to be left out, so nothing was typed or sent to it."""


class ClaimRefused(EmulatorError):
    """The thread is not ready for its claim follow-up (they wrote last, it already got a
    claim link, or the one waiting there is another club's), so nothing was sent."""


class ThreadReader:
    def __init__(
        self, device: EmulatorDevice, school: str, thread: str, opener: Callable[[], None]
    ) -> None:
        self._device = device
        # The school whose account the thread is in, which decides whether it may send.
        self._school = school
        # The thread's name as its inbox row shows it, which its header shows too.
        self._thread = thread
        # The username a request's header shows once its prompt named the thread by the
        # sender's display name: after accepting, only the username is on screen.
        self._username: str | None = None
        # Opens the thread from its inbox row, e.g. after a story repost leaves it.
        self._opener = opener
        # Whether the newest dated message on screen is over a week old; set by read.
        self.stale = False

    def read(self) -> list[dict[str, Any]]:
        """The thread's newest messages, oldest first, with each shared post's link."""
        nodes = self.open_thread()
        # A limited account can send nothing, so its threads are not read.
        raise_if_messaging_limited(nodes)
        self.stale = _newest_message_is_old(nodes)
        sender = _sender(nodes)
        messages = _messages(nodes)[-CONTROL.thread_item_limit :]
        # When our message is the newest there is nothing to answer, so no link is needed.
        if messages and messages[-1]["from"] == "them":
            messages = self._with_shared_links(messages)
            # While they are online the header shows only their display name.
            sender = sender or self._profile_username()
        return [
            {
                "from": message["from"],
                "type": message["type"],
                "text": message["text"][:1000],
                "shared_url": message["shared_url"],
                "sender": sender if message["from"] == "them" else None,
                "shared_owner": message["shared_owner"],
                # Reactions on it (ours under theirs, theirs under ours), such as "❤".
                "reactions": message["reactions"],
            }
            for message in messages
        ]

    def send_reply(self, text: str) -> None:
        """Send ``text`` in the thread, typed at a person's pace and confirmed first.

        The thread is opened from its inbox row and must be the one asked for. A message
        request shows its composer only once accepted (``accept``). Whatever the composer
        held before (an old draft no one approved) is cleared and never sent. Send is
        tapped only once the composer shows exactly ``text`` and the header still names
        the thread, and the composer must be empty after.
        """
        refuse_dms(self._school)
        nodes = self.open_thread()
        composer = self._device.find(_COMPOSER, nodes)
        if composer is None:
            raise EmulatorError("This thread is a message request; accept it first")
        self._device.tap(composer)
        self._device.clear_field()
        self._device.type_text(text)
        if _as_typed(_required(self._device.find(_COMPOSER)).text) != _as_typed(text):
            raise EmulatorError("The reply did not show in the thread's composer")
        self._device.pause()
        nodes = self._device.screen()
        self._require_thread(nodes)
        self._device.tap(_required(self._device.find(_SEND_BUTTON, nodes)))
        self._device.pause()
        if not _composer_empty(_required(self._device.find(_COMPOSER)).text):
            raise EmulatorError("The reply was still in the composer after Send")
        # The keyboard, then the thread.
        self._device.back()
        self._device.back()

    def heart(self) -> bool:
        """React with a heart to their newest message, unless it already has our reaction;
        True when this call reacted. A double tap is a message's quick reaction, and the
        reaction must then show under the message."""
        nodes = self.open_thread()
        theirs = [message for message in _messages(nodes) if message["from"] == "them"]
        if not theirs:
            raise EmulatorError("They have no message on screen to react to")
        newest = theirs[-1]
        if newest["reactions"]:
            return False
        bubble = newest["media"] or newest["node"]
        if bubble is None:
            raise EmulatorError("Their newest message could not be found on screen")
        self._device.double_tap(bubble)
        reacted = self._device.watch(
            lambda shown: _reacted_below(shown, bubble), seconds=_REACTION_WAIT_SECONDS
        )
        if not reacted:
            raise EmulatorError("Instagram did not show the heart under their message")
        return True

    def accept(self) -> bool:
        """Accept the thread if it is a message request; False when it is not one."""
        nodes = self.open_thread()
        if self._device.find(_COMPOSER, nodes) is not None:
            return False
        self._composer_shown(nodes)
        return True

    def send_claim(self, message: str, *, handle: str, tokens: frozenset[str]) -> str:
        """Send the club behind ``handle`` its claim-link message, the one DM the
        automation sends.

        The thread is opened from its inbox row and must be the club's own: its header
        names the thread and its sender is ``handle``, a club that never asked to be left
        out (in ``instagram_excluded_clubs`` or in a message on screen). Our message must
        be the newest on screen and none of ours may hold a claim link. A claim-link
        draft an earlier sitting typed is sent as it is only when its token is one of
        ``tokens``, the club's own; an empty composer gets ``message`` typed at a
        person's pace, confirmed in the composer. A composer holding any other unsent
        text is a reply waiting for a person and is left alone. Send is tapped after a
        pause, once the header still names the thread, and the composer must no longer
        hold the claim link.
        """
        refuse_dms(self._school)
        nodes = self.open_thread()
        sender = _sender(nodes)
        if sender is None:
            # While they are online the header shows only their display name.
            sender = self._profile_username()
            nodes = self.open_thread()
        if plain_handle(sender) != plain_handle(handle):
            raise ThreadMismatch(
                f"This thread's sender is {sender or 'unreadable'}, not {handle}, "
                "so nothing was sent"
            )
        refuse_if_excluded(sender)
        messages = _messages(nodes)
        if asks_to_be_left_out(messages):
            raise LeftOut("They asked in this thread to be left out, so nothing was sent")
        # A claim only follows up our last reply; anything they wrote since needs a person.
        if not messages or messages[-1]["from"] != "us":
            raise ClaimRefused("Our message is not the newest in this thread, so nothing was sent")
        if any(m["from"] == "us" and CLAIM_LINK.search(m["text"]) for m in messages):
            raise ClaimRefused("This thread already got a claim link, so nothing was sent")
        nodes = self._composer_shown(nodes)
        composer = _required(self._device.find(_COMPOSER, nodes))
        waiting = CLAIM_LINK.search(composer.text)
        typed = False
        if waiting:
            if waiting.group(1).casefold() not in tokens:
                raise ClaimRefused(
                    "The claim link waiting in this thread belongs to another club, "
                    "so nothing was sent"
                )
            outcome = "sent the claim message that was waiting in the thread"
        elif not composer.text.strip() or _COMPOSER_HINT.match(composer.text.strip()):
            self._device.tap(composer)
            self._device.type_text(message)
            shown = _required(self._device.find(_COMPOSER)).text
            if _as_typed(shown) != _as_typed(message):
                raise EmulatorError("The claim message did not show in the thread's composer")
            typed = True
            outcome = "typed and sent the claim message"
        else:
            raise ReplyWaiting(
                "This thread holds another unsent reply waiting for a person, so nothing was sent"
            )
        self._device.pause()
        nodes = self._device.screen()
        self._require_thread(nodes)
        self._device.tap(_required(self._device.find(_SEND_BUTTON, nodes)))
        self._device.pause()
        if CLAIM_LINK.search(_required(self._device.find(_COMPOSER)).text):
            raise EmulatorError("The claim message was still in the composer after Send")
        # The keyboard (when we typed) and then the thread are closed.
        for _ in range(2 if typed else 1):
            self._device.back()
        return outcome

    def open_thread(self) -> list[Node]:
        """Open the thread from its inbox row, every time, and return its screen once its
        header names it; any other thread on screen raises ``ThreadMismatch``."""
        self._opener()
        nodes = self._device.screen()
        self._require_thread(nodes)
        return nodes

    def _require_thread(self, nodes: list[Node]) -> None:
        if _in_thread(nodes) and _request_names(nodes, self._thread):
            self._username = _header_title(nodes)
        names = [self._thread, *([self._username] if self._username else [])]
        if not _in_thread(nodes) or not any(_names_thread(nodes, name) for name in names):
            raise ThreadMismatch(
                f"The thread on screen is not {self._thread!r}, so nothing was done in it"
            )

    def _composer_shown(self, nodes: list[Node]) -> list[Node]:
        """The thread's screen with its composer: a message request shows it only once
        accepted, and the thread must still be the one asked for after that."""
        if self._device.find(_COMPOSER, nodes) is not None:
            return nodes
        accept_request(self._device)
        nodes = self._device.screen()
        self._require_thread(nodes)
        return nodes

    def _screen_in_thread(self) -> list[Node]:
        """The screen, back in the thread asked for: it is opened again from its inbox row
        when another screen shows, and any other thread on screen is refused."""
        nodes = self._device.screen()
        if not _in_thread(nodes):
            return self.open_thread()
        self._require_thread(nodes)
        return nodes

    def _with_shared_links(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Copy the links of their newest few shared posts.

        A request is about the post just shared, so only the newest few need a link. When
        one of them is cut off at the top of the screen, the thread is scrolled up to bring
        it fully into view, and the messages from both screens are returned.
        """
        shares = _their_shares(messages)[-_SHARES_TO_READ:]
        for from_bottom, message in enumerate(reversed(shares)):
            message["shared_url"] = self._shared_link(from_bottom, message["shared_owner"])
        if len(shares) == _SHARES_TO_READ or not _cut_off(messages[0]):
            return messages
        if shares:
            # Reading a link leaves the thread wherever the app put it; start again from
            # its newest messages, with the share cut off at the top as before.
            self.open_thread()
        return self._revealed(messages)

    def _revealed(self, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Scroll up until the share cut off at the top of ``messages`` shows its owner, then
        copy its link; the messages under it, already read, are kept as they were."""
        below = messages[1:]
        for _scroll in range(_REVEAL_SCROLLS):
            self._device.scroll_up()
            above = _messages(self._device.screen())
            start = _start_of(below, above)
            share = above[start - 1] if start else None
            if share is None or not _their_shares([share]):
                continue
            newer_shares = len(_their_shares(above[start:]))
            share["shared_url"] = self._shared_link(newer_shares, share["shared_owner"])
            return [*above[:start], *below][-CONTROL.thread_item_limit :]
        # A post that never shows its owner, such as a deleted one, cannot be acted on.
        return messages

    def _profile_username(self) -> str | None:
        """Their username, from the profile their thread's details open."""
        self._device.tap(_required(self._device.find(_HEADER_TITLE)))
        try:
            self._device.tap_when(_PROFILE_SHORTCUT)
        except EmulatorError:
            # A group chat's details have no one profile.
            self._device.back()
            return None
        username = self._device.wait_for(_PROFILE_USERNAME).text
        self._device.back()
        self._device.back()
        return username if _USERNAME.fullmatch(username) else None

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
        pasted = self._read_back_link()
        # The keyboard shrinks the thread and hides older messages; put it away.
        self._device.back()
        match = _POST_LINK.match(pasted)
        return f"https://www.instagram.com/p/{match.group(1)}/" if match else None

    def _read_back_link(self) -> str:
        """Paste the copied link into the composer and read it back.

        An unsent draft already in the composer (one waiting for a person to send) is left
        exactly as it was: the cursor sits right after what was pasted, so only that is
        deleted again. An empty composer reads as its hint ("Message…"), which the paste
        replaces, so it is simply cleared.
        """
        composer = _required(self._device.find(_COMPOSER))
        before = composer.text
        self._device.tap(composer)
        if _JUNK_DRAFT.fullmatch(before.strip()):
            # Only post links: what an earlier read pasted and never took out again
            # (2026-11-27: ubc threads held three, a person opening them saw only those).
            self._clear_composer()
            before = _required(self._device.find(_COMPOSER)).text
        self._device.move_to_end()
        self._device.paste()
        self._device.pause()
        after = _required(self._device.find(_COMPOSER)).text
        pasted = _inserted(before, after)
        if pasted is None:
            self._clear_composer()
            return after
        self._device.delete_backward(len(pasted))
        if _required(self._device.find(_COMPOSER)).text != before:
            raise EmulatorError("The thread's unsent draft changed while its shared link was read")
        return pasted

    def _clear_composer(self) -> None:
        """Empty the composer, and make sure it is: a link left behind would sit in the
        thread as our draft for anyone opening it to see."""
        for _ in range(2):
            self._device.clear_field()
            self._device.pause()
            if _composer_empty(_required(self._device.find(_COMPOSER)).text):
                return
        raise EmulatorError("The pasted link would not leave the thread's composer")


def _inserted(before: str, after: str) -> str | None:
    """The one piece of text added to ``before`` to make ``after``, wherever it went in;
    None when ``after`` is not ``before`` plus one piece (a hint the paste replaced)."""
    added = len(after) - len(before)
    if not before or added <= 0:
        return None
    start = 0
    while start < len(before) and after[start] == before[start]:
        start += 1
    if after[start + added :] != before[start:]:
        return None
    return after[start : start + added]


def _in_thread(nodes: list[Node]) -> bool:
    return any(node.resource_id == "message_list" for node in nodes)


def _request_names(nodes: list[Node], thread: str) -> bool:
    """Whether a message request's prompt ("Accept message request from <name>") names
    ``thread``: a request's header shows only the sender's username, and the prompt their
    display name, the name a notification gives."""
    return any(
        node.resource_id == "thread_disabled_title"
        and _as_name(node.text.removeprefix("Accept message request from ")) == _as_name(thread)
        for node in nodes
    )


def _header_title(nodes: list[Node]) -> str | None:
    return next((node.label for node in nodes if node.resource_id == "header_title"), None)


def _names_thread(nodes: list[Node], thread: str) -> bool:
    """Whether the thread's header shows ``thread``, the name its inbox row shows: its
    title, or its username under the title or on its avatar."""
    wanted = _as_name(thread)
    header = [
        node.label.removeprefix("Open story of ")
        for node in nodes
        if node.resource_id in ("header_title", "header_subtitle", "header_avatar")
    ]
    return bool(wanted) and (
        any(_as_name(label) == wanted for label in header) or _request_names(nodes, thread)
    )


def _as_name(text: str) -> str:
    # Instagram wraps some names in invisible direction marks.
    return " ".join(text.replace("\u200e", "").replace("\u200f", "").casefold().split())


def asks_to_be_left_out(messages: list[dict[str, Any]]) -> bool:
    """Whether they wrote, in any of ``messages``, that we should stop featuring them."""
    return any(
        message.get("from") == "them" and _OPT_OUT.search(str(message.get("text") or ""))
        for message in messages
    )


def _composer_empty(text: str) -> bool:
    return not text.strip() or bool(_COMPOSER_HINT.match(text.strip()))


def _is_reaction(node: Node) -> bool:
    """Whether the node is a reaction pill under a message: a little emoji, not a message."""
    width, height = node.bounds[2] - node.bounds[0], node.bounds[3] - node.bounds[1]
    text = node.text.strip()
    return (
        bool(text)
        and not any(ch.isalnum() for ch in text)
        and width <= _REACTION_PILL_MAX
        and height <= _REACTION_PILL_MAX
    )


def _reacted_below(nodes: list[Node], bubble: Node) -> bool:
    """Whether a reaction pill now shows right under ``bubble``."""
    return any(
        _is_reaction(node)
        and bubble.bounds[3] - 10 <= node.bounds[1] <= bubble.bounds[3] + _REACTION_PILL_MAX
        and node.bounds[0] < bubble.bounds[2]
        for node in nodes
    )


def plain_handle(value: object) -> str:
    """An Instagram username as stored: no "@", in lower case."""
    return str(value or "").strip().lstrip("@").casefold()


def _their_shares(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Their shared posts whose owner is readable; one cut off at the top has no owner on
    screen, and a post with no owner can never be acted on."""
    return [
        m
        for m in messages
        if m["from"] == "them" and m["type"] == "media_share" and m["shared_owner"]
    ]


def _cut_off(message: dict[str, Any]) -> bool:
    """Whether the message is their share cut off at the top of the screen, its owner above it."""
    return message["from"] == "them" and message["cut_off"] and not message["shared_owner"]


def _start_of(below: list[dict[str, Any]], above: list[dict[str, Any]]) -> int | None:
    """Where ``below`` begins in ``above``, a screen scrolled up from it: after the longest
    run at the end of ``above`` that also starts ``below``. None when they do not meet."""
    above_keys = [_identity(message) for message in above]
    below_keys = [_identity(message) for message in below]
    if not below_keys:
        return len(above_keys)
    for overlap in range(min(len(above_keys), len(below_keys)), 0, -1):
        if above_keys[-overlap:] == below_keys[:overlap]:
            return len(above_keys) - overlap
    return None


def _identity(message: dict[str, Any]) -> tuple[str, str, str | None]:
    # A share at the bottom edge of the screen may hide its caption, but never its owner.
    detail = message["shared_owner"] if message["type"] == "media_share" else message["text"]
    return message["from"], message["type"], detail


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
    """The other person's username, from the header of a one-to-one thread, if it shows."""
    title = next((node.label for node in nodes if node.resource_id == "header_title"), "")
    subtitle = next((node.label for node in nodes if node.resource_id == "header_subtitle"), "")
    # While they are online the subtitle says "Active now"; a story ring on their avatar
    # still names them.
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
    # Banners such as "Your notifications are off. Turn on" sit in a tray over the list.
    trays = [node for node in inside if node.resource_id == "message_composer_tray_container"]
    bubbles = [node for node in inside if node.resource_id == "xma_bubble_container"]
    # A shared reel can also be drawn as a bare media card, its owner above the video.
    cards = [
        node
        for node in inside
        if node.resource_id == "media_container"
        and not any(node.inside(bubble) for bubble in bubbles)
    ]
    found: list[tuple[int, dict[str, Any]]] = []
    pills: list[Node] = []
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
                    "node": bubble,
                    "card": False,
                    "cut_off": bubble.bounds[1] <= message_list.bounds[1],
                    "reactions": "",
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
                    "node": card,
                    "card": True,
                    "cut_off": card.bounds[1] <= message_list.bounds[1],
                    "reactions": "",
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
            or any(node.inside(container) for container in [*bubbles, *cards, *trays])
        ):
            continue
        if _is_reaction(node):
            pills.append(node)
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
                    "node": node,
                    "card": False,
                    "cut_off": False,
                    "reactions": "",
                },
            )
        )
    messages = [message for _top, message in sorted(found, key=lambda pair: pair[0])]
    # A reaction pill sits under the message it reacts to: the last one that starts above it.
    for pill in pills:
        above = [m for m in messages if m["node"].bounds[1] < pill.bounds[1]]
        if above:
            above[-1]["reactions"] += pill.text.strip()
    return messages


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


def _as_typed(text: str) -> str:
    return " ".join(text.casefold().split())


def dms_refused(school: str) -> bool:
    """Whether the school's account may never send a DM: a French-language school
    (``schools.language``, Tony 2026-11-26), or a school the database does not know."""
    record = school_service.get_school(school)
    return record is None or record.language == "fr"


def refuse_dms(school: str) -> None:
    """Raise ``NoDms`` when the school's account may never send a DM."""
    if dms_refused(school):
        raise NoDms("no DMs on French schools")


def refuse_if_excluded(sender: str) -> None:
    """Raise ``LeftOut`` when the thread's sender asked to be left out: nothing is typed
    or sent to a club in ``instagram_excluded_clubs``."""
    excluded = (
        get_sb()
        .table(INSTAGRAM_EXCLUDED_CLUBS)
        .select("ig_handle")
        .eq("ig_handle", plain_handle(sender))
        .execute()
    ).data
    if excluded:
        raise LeftOut(f"{sender} asked to be left out; send it nothing")


def exclude_club(ig_handle: str, *, reason: str) -> None:
    """Leave a club out of every carousel from now on; asking again changes nothing."""
    get_sb().table(INSTAGRAM_EXCLUDED_CLUBS).upsert(
        {"ig_handle": plain_handle(ig_handle), "reason": reason},
        on_conflict="ig_handle",
        ignore_duplicates=True,
    ).execute()
