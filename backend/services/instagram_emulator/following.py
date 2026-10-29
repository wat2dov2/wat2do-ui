"""Read accounts' Following lists, and follow accounts, from the emulator's Instagram app.

A Following list has its own search field. Each row it shows carries the button the
signed-in school account would press: "Follow" or "Follow back" for an account we
don't follow yet, "Message" or "Following" for one we do. So one search of a
followed club's list tells us both who it follows and which of those we are missing.

Following an account also turns its post notifications to All, since ingestion only
hears about posts from accounts whose bell is set that way. Instagram's "Try again
later" block stops the account for the day; it is never pushed through.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node, labels

_PROFILE_TITLE = re.compile(r"^action_bar_title$")
_FOLLOWING_COUNT = re.compile(r"^profile_header_following_stacked_familiar$")
_FOLLOW_BUTTON = re.compile(r"^profile_header_follow_button$")
_SEARCH = re.compile(r"^row_search_edit_text$")
_NO_RESULTS = re.compile(r"^row_no_results_textview$")
_HIDDEN = labels(
    "This account is private",
    "This Account is Private",
    "Sorry, this page isn't available",
    "User not found",
)
_BLOCKED = labels(
    "Try Again Later", "Try again later", "We restrict certain activity", "We limit how often"
)
_BELL = re.compile(r"^Open notification settings$")
_POSTS = re.compile(r"^Posts$")
_ALL = re.compile(r"^All$")
_FOLLOWED_LABELS = ("Message", "Following", "Requested")
_UNFOLLOWED_LABELS = ("Follow", "Follow back")
_ROW_NAME = "follow_list_username"
_ROW_BUTTON = "follow_list_row_large_follow_button"
_SETTLE_SECONDS = 3


class ActionBlocked(EmulatorError):
    """Instagram refused an action from this account for now ("Try again later")."""


@dataclass(frozen=True)
class FollowOutcome:
    label: str
    # False when the school account already followed it and only its bell was checked.
    tapped: bool


@dataclass(frozen=True)
class FollowingRow:
    username: str
    name: str
    followed: bool


class FollowingReader:
    """One school account's view of profiles on the emulator; the caller holds the lock."""

    def __init__(
        self, device: EmulatorDevice, user: int, *, profile_wait_seconds: float, max_scrolls: int
    ) -> None:
        self._device = device
        self._user = user
        self._profile_wait_seconds = profile_wait_seconds
        self._max_scrolls = max_scrolls

    def search_following(self, username: str, terms: list[str]) -> list[FollowingRow] | None:
        """Every row the profile's Following list shows for the terms; None if it is hidden.

        The list is reopened for each term: its search field sits at the top, which a
        long scroll leaves far behind.
        """
        found: dict[str, FollowingRow] = {}
        for term in terms:
            count = self._open_profile(username, _FOLLOWING_COUNT)
            if count is None:
                return None
            if count.description.startswith("0following"):
                return []
            self._device.tap(count)
            self._device.tap(self._device.wait_for(_SEARCH))
            self._device.type_text(term)
            time.sleep(_SETTLE_SECONDS)
            self._hide_keyboard()
            for _ in range(self._max_scrolls):
                nodes = self._device.screen()
                if self._device.find(_NO_RESULTS, nodes) is not None:
                    break
                before = len(found)
                for row in _rows(nodes):
                    found.setdefault(row.username, row)
                if len(found) == before:
                    break
                self._device.scroll_down()
        return list(found.values())

    def follow(self, username: str) -> FollowOutcome | None:
        """Follow the account unless we already do, and set its posts to All.

        The label is "Following" for a public account and "Requested" for a private one
        waiting on its owner; ``tapped`` says whether this call followed it. None when
        the profile is gone or hidden.
        """
        button = self._open_profile(username, _FOLLOW_BUTTON)
        if button is None:
            return None
        tapped = button.text in _UNFOLLOWED_LABELS
        if tapped:
            self._device.tap(button)
            button = self._wait_for_button(_FOLLOWED_LABELS)
        if button.text == "Following":
            self._set_posts_to_all()
        return FollowOutcome(button.text, tapped)

    def _open_profile(self, username: str, control: re.Pattern[str]) -> Node | None:
        self._device.open_instagram(self._user, f"instagram://user?username={username}")
        deadline = time.monotonic() + self._profile_wait_seconds
        while True:
            nodes = self._device.screen()
            self._raise_if_blocked(nodes)
            if self._device.find(_HIDDEN, nodes) is not None:
                return None
            title = self._device.find(_PROFILE_TITLE, nodes)
            node = self._device.find(control, nodes)
            if title is not None and title.text.strip().casefold() == username and node is not None:
                return node
            if time.monotonic() >= deadline:
                raise EmulatorError("Instagram profile never loaded")
            time.sleep(1)

    def _wait_for_button(self, wanted: tuple[str, ...]) -> Node:
        deadline = time.monotonic() + self._profile_wait_seconds
        while True:
            nodes = self._device.screen()
            self._raise_if_blocked(nodes)
            button = self._device.find(_FOLLOW_BUTTON, nodes)
            if button is not None and button.text in wanted:
                return button
            if time.monotonic() >= deadline:
                raise EmulatorError("Instagram never confirmed the follow")
            time.sleep(1)

    def _set_posts_to_all(self) -> None:
        if self._posts_setting() != "All":
            self._device.tap(self._device.wait_for(_POSTS))
            self._device.tap(self._device.wait_for(_ALL))
            time.sleep(_SETTLE_SECONDS)
            if self._posts_setting() != "All":
                raise EmulatorError("Instagram kept the account's post notifications off All")
        self._device.back()

    def _posts_setting(self) -> str:
        """Open the bell's sheet and read the value under its Posts row."""
        self._device.tap(self._device.wait_for(_BELL))
        posts = self._device.wait_for(_POSTS)
        nodes = self._device.screen()
        values = [
            node.text
            for node in nodes
            if node.resource_id == "context_menu_item_sub_label" and node.inside(posts)
        ]
        return values[0] if values else ""

    def _hide_keyboard(self) -> None:
        """The keyboard covers half the list and swallows the scroll swipes."""
        if "mInputShown=true" in self._device.adb("shell", "dumpsys", "input_method"):
            self._device.back()

    def _raise_if_blocked(self, nodes: list[Node]) -> None:
        if self._device.find(_BLOCKED, nodes) is not None:
            raise ActionBlocked("Instagram asked this account to try again later")


def _rows(nodes: list[Node]) -> list[FollowingRow]:
    """Each list row on screen; a row cut off by the bottom edge waits for the next scroll.

    The button's label reads "Follow <name>" or "Message <name>", so the display name
    comes from there.
    """
    buttons = [node for node in nodes if node.resource_id == _ROW_BUTTON]
    rows = []
    for name in (node for node in nodes if node.resource_id == _ROW_NAME):
        top = name.bounds[1]
        button = next((b for b in buttons if b.bounds[1] - 80 <= top <= b.bounds[3]), None)
        label = button.text.strip() if button is not None else ""
        if label not in _FOLLOWED_LABELS + _UNFOLLOWED_LABELS:
            continue
        description = button.description
        display = description[len(label) :].strip() if description.startswith(label) else ""
        rows.append(FollowingRow(name.text.strip().casefold(), display, label in _FOLLOWED_LABELS))
    return rows
