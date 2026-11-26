"""Read a school account's DM inbox in the Instagram app and open a thread from it.

The scheduled DM sweep works from the inbox instead of push notifications: it lists
the threads, both the main inbox and message requests, and opens each one that may
need an answer by tapping its row. A row is read from what the app draws: the
other person's name, the latest message (or a status such as "Sent 1h ago") and
its age, and whether Instagram marks it unread.
"""

from __future__ import annotations

import re
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
_NO_REQUESTS = re.compile(r"^No message requests$|^You don't have any message requests")
# Opening requests can first ask about message privacy; it is put off, never changed.
_NOT_NOW = re.compile(r"^Not now$")
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
_REQUEST_PROMPT = re.compile(r"^thread_disabled_title$")
# The same banner says when Instagram has limited the account's messages.
_MESSAGING_LIMITED = re.compile(r"^You can.t send messages")
_ACCEPT = re.compile(r"^Accept$")
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
    else from the inbox's search, which finds a chat however old it is.

    A request moves to the main inbox once accepted, so both lists are searched.
    """
    for requests in (False, True):
        if not _open_list(device, user, requests=requests):
            continue
        for _scroll in range(CONTROL.inbox_scrolls + 1):
            row = next((node for node in _row_nodes(device.screen()) if _name(node) == name), None)
            if row is not None:
                _enter(device, row)
                return
            device.scroll_down()
    if not _open_by_search(device, user, name):
        raise EmulatorError("The DM thread is no longer in the inbox")


def _enter(device: EmulatorDevice, row: Node) -> None:
    device.tap(row)
    device.wait_for(re.compile(f"{_COMPOSER.pattern}|{_REQUEST_PROMPT.pattern}"))
    device.pause()


def _open_by_search(device: EmulatorDevice, user: int, name: str) -> bool:
    """Open an existing chat named ``name`` from the inbox's search (its chats list above
    "More accounts", which are only accounts to start a chat with); False when none shows.
    Only the name is typed, into the search field."""
    _open_list(device, user, requests=False)
    device.tap_when(_INBOX_SEARCH)
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

    row = device.watch(chat)
    if row is None:
        return False
    _enter(device, row)
    return True


def accept_request(device: EmulatorDevice) -> None:
    """Accept the open message request, if it is one, so the thread can be answered."""
    prompt = device.find(_REQUEST_PROMPT)
    if prompt is None:
        return
    raise_if_messaging_limited([prompt])
    device.tap_when(_ACCEPT)
    # Some accounts then ask which inbox the thread moves to; Primary is where we look.
    shown = device.wait_for(re.compile(f"{_COMPOSER.pattern}|{_MOVE_TO_PRIMARY.pattern}"))
    if shown.labelled(_MOVE_TO_PRIMARY):
        device.tap(shown)
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
    if not requests:
        return True
    link = device.find(_REQUESTS_TAB)
    if link is None:
        return False
    device.tap(link)
    # The list opens a moment after its title, or behind a privacy prompt.
    shown = device.wait_for(re.compile(f"{_REQUESTS_TITLE.pattern}|{_NOT_NOW.pattern}"))
    if shown.labelled(_NOT_NOW):
        device.tap(shown)
        device.wait_for(_REQUESTS_TITLE)
    device.watch(lambda nodes: _row_nodes(nodes) or device.find(_NO_REQUESTS, nodes))
    return True


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
