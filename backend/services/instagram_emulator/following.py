"""Read accounts' Following lists, and follow accounts, from the emulator's Instagram app.

A Following list has its own search field. Each row it shows carries the button the
signed-in school account would press: "Follow" or "Follow back" for an account we
don't follow yet, "Message" or "Following" for one we do. So one search of a
followed club's list tells us both who it follows and which of those we are missing.

Following an account also turns its post notifications to All, since ingestion only
hears about posts from accounts whose bell is set that way. Unfollowing taps the same
button and confirms in the sheet it opens. Instagram's "Try again later" block stops
the account for the day; it is never pushed through. A profile that fails starts the
app afresh, so a sheet it left open never covers the profiles after it.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
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
_UNFOLLOW = labels("Unfollow", "Cancel request", "Cancel Request")
_FOLLOWED_LABELS = ("Message", "Following", "Requested")
_UNFOLLOWED_LABELS = ("Follow", "Follow back")
_ROW_NAME = "follow_list_username"
_ROW_BUTTON = "follow_list_row_large_follow_button"
# The longest a search waits for the list to show only matches, and a changed bell
# setting for its sheet to close.
_SETTLE_SECONDS = 3


class ActionBlocked(EmulatorError):
    """Instagram refused an action from this account for now ("Try again later")."""


class FollowNotConfirmed(EmulatorError):
    """The Follow tap never turned into Following; several in a row is Instagram's silent limit."""


class FollowedWithoutBell(EmulatorError):
    """This call followed the account, but its post notifications could not be set to All."""


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


@dataclass(frozen=True)
class _Profile:
    """A profile that finished loading: the control looked for, or None when it is gone or hidden."""

    control: Node | None


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
        with self._recovering():
            for term in terms:
                count = self._open_profile(username, _FOLLOWING_COUNT)
                if count is None:
                    return None
                if count.description.startswith("0following"):
                    return []
                self._device.tap(count)
                self._device.tap_when(_SEARCH)
                self._device.type_text(term)
                self._device.watch(lambda nodes: _filtered(nodes, term), seconds=_SETTLE_SECONDS)
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
        the profile is gone or hidden. ``FollowedWithoutBell`` when this call followed
        it but the bell step failed.
        """
        with self._recovering():
            button = self._open_profile(username, _FOLLOW_BUTTON)
            if button is None:
                return None
            tapped = button.text in _UNFOLLOWED_LABELS
            if tapped:
                self._device.tap(button)
                try:
                    button = self._wait_for_button(_FOLLOWED_LABELS)
                except ActionBlocked:
                    raise
                except EmulatorError as exc:
                    raise FollowNotConfirmed(str(exc)) from exc
            if button.text == "Following":
                try:
                    self._show_bell(username)
                    self._set_posts_to_all()
                except EmulatorError as exc:
                    # The follow already happened, so it must still count toward the day's.
                    if tapped:
                        raise FollowedWithoutBell(str(exc)) from exc
                    raise
            return FollowOutcome(button.text, tapped)

    def unfollow(self, username: str) -> bool | None:
        """Unfollow the account, or withdraw the request to a private one.

        False when the school account did not follow it anyway, None when the profile
        is gone or hidden.
        """
        with self._recovering():
            button = self._open_profile(username, _FOLLOW_BUTTON)
            if button is None:
                return None
            if button.text in _UNFOLLOWED_LABELS:
                return False
            self._device.tap(button)
            self._device.tap_when(_UNFOLLOW)
            self._wait_for_button(_UNFOLLOWED_LABELS, "Instagram never confirmed the unfollow")
            return True

    @contextmanager
    def _recovering(self) -> Iterator[None]:
        """Start the app afresh after a step fails: a sheet it left open, such as the
        bell's, would cover every profile opened after it."""
        try:
            yield
        except EmulatorError:
            self._device.reset_app(self._user)
            raise

    def _open_profile(self, username: str, control: re.Pattern[str]) -> Node | None:
        """The profile's ``control`` once the profile shows; None when it is gone or hidden."""
        self._device.open_instagram(self._user, f"instagram://user?username={username}")
        loaded = self._device.watch(
            lambda nodes: self._loaded(nodes, username, control),
            seconds=self._profile_wait_seconds,
        )
        if loaded is None:
            raise EmulatorError("Instagram profile never loaded")
        return loaded.control

    def _loaded(
        self, nodes: list[Node], username: str, control: re.Pattern[str]
    ) -> _Profile | None:
        self._raise_if_blocked(nodes)
        if self._device.find(_HIDDEN, nodes) is not None:
            return _Profile(None)
        title = self._device.find(_PROFILE_TITLE, nodes)
        node = self._device.find(control, nodes)
        if title is not None and title.text.strip().casefold() == username and node is not None:
            return _Profile(node)
        return None

    def _wait_for_button(
        self, wanted: tuple[str, ...], error: str = "Instagram never confirmed the follow"
    ) -> Node:
        def look(nodes: list[Node]) -> Node | None:
            self._raise_if_blocked(nodes)
            button = self._device.find(_FOLLOW_BUTTON, nodes)
            return button if button is not None and button.text in wanted else None

        button = self._device.watch(look, seconds=self._profile_wait_seconds)
        if button is None:
            raise EmulatorError(error)
        return button

    def _show_bell(self, username: str) -> None:
        """Instagram often leaves the bell off a followed profile's first load; the next open shows it."""
        if self._device.find(_BELL) is None:
            self._open_profile(username, _BELL)

    def _set_posts_to_all(self) -> None:
        if self._posts_setting() != "All":
            self._device.tap_when(_POSTS)
            self._device.tap_when(_ALL)
            self._device.watch(
                lambda nodes: self._device.find(_POSTS, nodes) is None, seconds=_SETTLE_SECONDS
            )
            if self._posts_setting() != "All":
                raise EmulatorError("Instagram kept the account's post notifications off All")
        self._device.back()

    def _posts_setting(self) -> str:
        """Open the bell's sheet and read the value under its Posts row."""
        self._device.tap_when(_BELL)
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


def _filtered(nodes: list[Node], term: str) -> bool:
    """Whether the list shows only accounts matching the search term, or says none match.

    Right after typing, the list still shows everything it showed before the search.
    """
    if any(node.labelled(_NO_RESULTS) for node in nodes):
        return True
    rows = _rows(nodes)
    return bool(rows) and all(
        term.casefold() in f"{row.username} {row.name}".casefold() for row in rows
    )


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
