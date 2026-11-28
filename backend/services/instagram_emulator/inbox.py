"""Read a school account's DM inbox in the Instagram app and open a thread from it.

The scheduled DM sweep works from the inbox instead of push notifications: it lists
the threads, both the main inbox and message requests, and opens each one that may
need an answer by tapping its row. A row is read from what the app draws: the
other person's name, the latest message (or a status such as "Sent 1h ago") and
its age, and whether Instagram marks it unread.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass

from core.controlbox import controlbox
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node

CONTROL = controlbox.instagram_dms
# The tab reads "Requests, 2 unread messages"; an inbox without tabs has a "Requests (1)"
# link above its threads instead (angrygooseinuw, 2026-11-25).
_REQUESTS_TAB = re.compile(r"^Requests(?: \(\d+\))?(?:, .*)?$")
_TABS = re.compile(r"^(?:All|Primary|General|Requests)(?: \(\d+\))?(?:, .*)?$")
# The inbox's search: its box, the field it opens, and the header of the accounts it
# suggests below the chats it found.
_INBOX_SEARCH = re.compile(r"^(?:Search or ask Meta AI|Ask Meta AI or Search|Search)$")
_SEARCH_FIELD = re.compile(r"^search_bar_real_field$")
_MORE_ACCOUNTS = re.compile(r"^More accounts$")
_REQUESTS_TITLE = re.compile(r"^Message requests$")
# How many requests are looked into for one whose header names the sender.
_REQUEST_LOOKS = 10
# The heading at the top of the inbox's thread list.
_MESSAGES_HEADER = re.compile(r"^Messages$")
# The search box, the "Messages" heading and the Requests tab or link scroll away with
# the list, so any one of them showing means its top is on screen.
_INBOX_TOP = re.compile(
    "|".join(pattern.pattern for pattern in (_INBOX_SEARCH, _MESSAGES_HEADER, _REQUESTS_TAB))
)
_NO_REQUESTS = re.compile(r"^No message requests$|^You don't have any message requests")
# Opening requests can first ask about message privacy; it is put off, never changed.
_NOT_NOW = re.compile(r"^Not now$")
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
_REQUEST_PROMPT = re.compile(r"^thread_disabled_title$")
# A thread shows its composer once open, or a request its accept prompt instead.
_THREAD_OPEN = re.compile(f"{_COMPOSER.pattern}|{_REQUEST_PROMPT.pattern}")
# The app's bottom tab bar (Home, Reels, Messages, Search, Profile), drawn over the inbox.
_TAB_BAR = re.compile(r"^tab_bar$")
# Taps on a thread's row before giving up on it opening.
_ENTER_ATTEMPTS = 2
# The same banner says when Instagram has limited the account's messages.
_MESSAGING_LIMITED = re.compile(r"^You can.t send messages")
_ACCEPT = re.compile(r"^Accept$")
# Shown after accepting a business account's request (angrygooseinuw, 2026-11-26).
_BUSINESS_PRIVACY = re.compile(r"^Business chats and your privacy")
_CLOSE = re.compile(r"^Close$")
_MOVE_TO_PRIMARY = re.compile(r"^igds_alert_dialog_primary_button$")
_AGE = re.compile(r"^(now|\d+)([smhdw]?)$")
_DAYS_PER_UNIT = {"s": 1 / 86_400, "m": 1 / 1440, "h": 1 / 24, "d": 1, "w": 7, "": 0}
# Previews that show our message was the latest. Once a thread is read, Instagram may
# show who is active ("Active 2h ago") instead, which says nothing about who wrote last.
_OURS = re.compile(r"^(?:You:|You sent|Sent\b|Seen\b)")
# A thread row spans the screen from its left edge and is about one avatar tall.
_ROW_HEIGHT = (150, 260)


class MessagingLimited(EmulatorError):
    """Instagram has limited this account's messages, so no thread can be answered."""


class ThreadNotFound(EmulatorError):
    """No inbox row, request or search result is the thread asked for."""


@dataclass(frozen=True)
class InboxRow:
    name: str
    preview: str
    age_days: float | None
    unread: bool
    request: bool

    @property
    def ours(self) -> bool:
        """Whether the preview shows our message as the latest."""
        return bool(_OURS.match(self.preview))


def read_inbox(device: EmulatorDevice, user: int, *, requests: bool) -> list[InboxRow]:
    """The newest threads in the main inbox, or in message requests, top to bottom.

    Scrolls until the oldest row is past ``max_thread_age_days`` or the list ends.
    """
    if not _open_list(device, user, requests=requests):
        return []
    found: dict[str, InboxRow] = {}
    for scroll in range(CONTROL.inbox_scrolls + 1):
        rows = _rows(device.screen(), request=requests)
        new = [row for row in rows if row.name not in found]
        for row in new:
            found[row.name] = row
        oldest = rows[-1].age_days if rows else None
        if not new or (oldest is not None and oldest > CONTROL.max_thread_age_days):
            break
        if scroll < CONTROL.inbox_scrolls:
            device.scroll_down()
    return list(found.values())


def open_row(device: EmulatorDevice, user: int, name: str) -> None:
    """Open the thread with ``name`` from the main inbox, or from requests if it is there,
    else the request whose thread is titled ``name``, else from the inbox's search, which
    finds a chat however old it is.

    A request moves to the main inbox once accepted, so both lists are searched. A
    request row shows only the sender's username while a notification names them by
    their display name, which only the thread's own header shows.
    """
    for requests in (False, True):
        if not _open_list(device, user, requests=requests):
            continue
        for _scroll in range(CONTROL.inbox_scrolls + 1):
            if _row_named(device.screen(), name) is not None:
                _enter(device, lambda nodes: _row_named(nodes, name))
                return
            device.scroll_down()
    if _open_request_titled(device, user, name):
        return
    if not _open_by_search(device, user, name):
        raise ThreadNotFound("The DM thread is no longer in the inbox")


def _row_named(nodes: list[Node], name: str) -> Node | None:
    """The row of the thread ``name`` that can be tapped: the bottom tab bar is drawn over
    the list, and a row behind it shows only a sliver above it (a tap there lands on a
    tab), so such a row counts as not on screen yet and is scrolled up into view
    (testu 2026-11-28: wat2do.guelph's row, 12 px above the tab bar, never opened)."""
    tab_bar_top = min((node.bounds[1] for node in nodes if node.labelled(_TAB_BAR)), default=10**6)
    return next(
        (
            node
            for node in _row_nodes(nodes)
            if _name(node) == name and node.bounds[3] <= tab_bar_top
        ),
        None,
    )


def _open_request_titled(device: EmulatorDevice, user: int, name: str) -> bool:
    """Open the message request whose thread names ``name`` (its header, or its prompt
    "Accept message request from <display name>"), looking into each request in turn
    (the sender is not told a request was opened); False when none is."""
    if not _open_list(device, user, requests=True):
        return False
    looked: set[str] = set()
    for _ in range(_REQUEST_LOOKS):
        rows = [row for row in _row_nodes(device.screen()) if _name(row) not in looked]
        if not rows:
            return False
        looked.add(_name(rows[0]))
        _enter(device, lambda nodes, row=_name(rows[0]): _row_named(nodes, row))
        nodes = device.screen()
        title = next((node.label for node in nodes if node.resource_id == "header_title"), "")
        prompt = next(
            (node.text for node in nodes if node.resource_id == "thread_disabled_title"), ""
        )
        if name in (title, prompt.removeprefix("Accept message request from ")):
            return True
        device.back()
        device.wait_for(_REQUESTS_TITLE)
    return False


def _enter(device: EmulatorDevice, row: Callable[[list[Node]], Node | None]) -> None:
    """Tap the row ``row`` finds and wait for its thread to open.

    The row is found again on a screen read after the pause before the tap: a list that
    is still settling (rows loading or moving under a tray that just appeared) would
    otherwise be tapped where the row used to be (2026-11-28: the first read after an
    account switch tapped beside its thread and waited for a composer that never came).
    A tap that opened nothing, with the list still on screen, is made once more.
    """
    for attempt in range(_ENTER_ATTEMPTS):
        try:
            device.tap_found(row)
        except EmulatorError:
            if attempt:
                raise
            # The row went out of sight while settling; it is looked for once more.
            continue
        if device.watch(lambda nodes: device.find(_THREAD_OPEN, nodes)):
            device.pause()
            return
        if attempt == _ENTER_ATTEMPTS - 1 or row(device.screen()) is None:
            break
    raise EmulatorError(f"Instagram never showed {_THREAD_OPEN.pattern}")


def _open_by_search(device: EmulatorDevice, user: int, name: str) -> bool:
    """Open an existing chat named ``name`` from the inbox's search (its chats list above
    "More accounts", which are only accounts to start a chat with); False when none shows.
    Only the name is typed, into the search field."""
    _open_list(device, user, requests=False)
    search = _scrolled_up_to(device, _INBOX_SEARCH)
    if search is None:
        raise EmulatorError("The inbox's search box never showed")
    device.tap(search)
    device.tap(device.wait_for(_SEARCH_FIELD))
    device.type_text(name)

    def chat(nodes: list[Node]) -> Node | None:
        accounts_top = min(
            (node.bounds[1] for node in nodes if node.labelled(_MORE_ACCOUNTS)), default=10**6
        )
        return next(
            (
                node
                for node in nodes
                if node.resource_id == "row_inbox_username"
                and node.text == name
                and node.bounds[3] <= accounts_top
            ),
            None,
        )

    if device.watch(chat) is None:
        return False
    _enter(device, chat)
    return True


def accept_request(device: EmulatorDevice) -> None:
    """Accept the open message request, if it is one, so the thread can be answered."""
    prompt = device.find(_REQUEST_PROMPT)
    if prompt is None:
        return
    raise_if_messaging_limited([prompt])
    device.tap_when(_ACCEPT)
    # Some accounts then ask which inbox the thread moves to (Primary is where we look),
    # or explain business chats' privacy (closed, nothing changed), before the composer.
    after = re.compile(
        f"{_COMPOSER.pattern}|{_MOVE_TO_PRIMARY.pattern}|{_BUSINESS_PRIVACY.pattern}"
    )
    for _ in range(3):
        shown = device.wait_for(after)
        if shown.labelled(_COMPOSER):
            break
        if shown.labelled(_MOVE_TO_PRIMARY):
            device.tap(shown)
        else:
            device.tap_when(_CLOSE)
    else:
        device.wait_for(_COMPOSER)
    device.pause()


def raise_if_messaging_limited(nodes: list[Node]) -> None:
    prompt = next((node for node in nodes if node.labelled(_REQUEST_PROMPT)), None)
    if prompt is not None and _MESSAGING_LIMITED.match(prompt.text):
        raise MessagingLimited("Instagram has limited this account's messages")


def _open_list(device: EmulatorDevice, user: int, *, requests: bool) -> bool:
    """Open the main inbox, or its message requests; False when there are no requests.

    A short inbox shows neither the All/Primary tabs nor a Requests link.
    """
    device.open_inbox(user)
    device.pause()
    _settle_inbox(device)
    if not requests:
        return True
    link = _requests_link(device)
    if link is None:
        return False
    opened = re.compile(f"{_REQUESTS_TITLE.pattern}|{_NOT_NOW.pattern}")
    device.tap(link)
    # The list opens a moment after its title, or behind a privacy prompt. A tap that
    # landed while the inbox was still settling from a scroll is made once more.
    shown = device.watch(lambda nodes: device.find(opened, nodes))
    if shown is None:
        device.tap(_required_link(device))
        shown = device.wait_for(opened)
    if shown.labelled(_NOT_NOW):
        device.tap(shown)
        device.wait_for(_REQUESTS_TITLE)
    device.watch(lambda nodes: _row_nodes(nodes) or device.find(_NO_REQUESTS, nodes))
    return True


def _settle_inbox(device: EmulatorDevice) -> None:
    """Bring the inbox back to its top and wait for its rows to stop changing.

    The inbox reopens wherever it was last scrolled, and right after an account switch
    or a cold start its title shows before its threads: they load, and a notes tray or
    banner drawn above them a moment later pushes them down. A row read too early is
    missed (the thread is then taken for gone) or tapped where it no longer is. The
    rows count as settled once two reads in a row show the same ones in the same
    places; an inbox with no rows at all is waited for at most ``screen_wait_seconds``.
    """
    # No drag when the top already shows: a drag down there only refreshes the list.
    _scrolled_up_to(device, _INBOX_TOP)
    seen: list[list[tuple[str, tuple[int, int, int, int]]]] = []

    def settled(nodes: list[Node]) -> bool:
        rows = [(_name(row), row.bounds) for row in _row_nodes(nodes)]
        steady = bool(rows) and bool(seen) and rows == seen[-1]
        seen.append(rows)
        return steady

    device.watch(settled)


def _required_link(device: EmulatorDevice) -> Node:
    link = _requests_link(device)
    if link is None:
        raise EmulatorError("The inbox's Requests link went away")
    return link


def _requests_link(device: EmulatorDevice) -> Node | None:
    """The Requests tab or link, scrolled back into view: the inbox reopens where it was
    last scrolled. None once the top of the list ("Messages") shows without it."""
    return _scrolled_up_to(device, _REQUESTS_TAB, stop=_MESSAGES_HEADER)


def _scrolled_up_to(
    device: EmulatorDevice, pattern: re.Pattern[str], *, stop: re.Pattern[str] | None = None
) -> Node | None:
    """Scroll the inbox up until a control matching ``pattern`` shows; None when ``stop``
    shows first or scrolling up changes nothing (the top).

    A drag up moves the list about a third as far as a scroll down, so the bound covers
    the bottom of a list read to its end (testu 2026-11-28: nine drags fell one short).
    """
    seen: list[Node] | None = None
    for _ in range(4 * (CONTROL.inbox_scrolls + 1) + 1):
        nodes = device.screen()
        found = device.find(pattern, nodes)
        if found is not None or (stop is not None and device.find(stop, nodes) is not None):
            return found
        if nodes == seen:
            return None
        seen = nodes
        device.scroll_up()
    return None


def _rows(nodes: list[Node], *, request: bool) -> list[InboxRow]:
    rows = []
    for row in _row_nodes(nodes):
        texts = [
            node.text.strip("‎ ").strip()
            for node in nodes
            if node.text and node is not row and node.inside(row)
        ]
        if len(texts) < 2:
            continue
        name, preview, *rest = texts
        age = _age_days(rest[-1]) if rest else None
        rows.append(
            InboxRow(
                name=name,
                preview=preview.removesuffix("·").strip(),
                age_days=age,
                unread=row.description.startswith(f"{name}, unread,"),
                request=request,
            )
        )
    return rows


def _row_nodes(nodes: list[Node]) -> list[Node]:
    """Thread rows: flush with the left edge, one avatar tall, labelled "name, ..."."""
    tabs_bottom = max((node.bounds[3] for node in nodes if node.labelled(_TABS)), default=0)
    return [
        node
        for node in nodes
        if node.bounds[0] == 0
        and node.bounds[1] >= tabs_bottom
        and _ROW_HEIGHT[0] <= node.bounds[3] - node.bounds[1] <= _ROW_HEIGHT[1]
        and ", " in node.description
    ]


def _name(row: Node) -> str:
    return row.description.split(", ", 1)[0]


def _age_days(text: str) -> float | None:
    match = _AGE.match(text.strip("‎ ").strip())
    if match is None:
        return None
    count, unit = match.groups()
    return 0.0 if count == "now" else int(count) * _DAYS_PER_UNIT[unit]
