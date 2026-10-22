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
INBOX_URL = "instagram://direct-inbox"
_REQUESTS_TAB = re.compile(r"^Requests(?:, .*)?$")
_TABS = re.compile(r"^(?:All|Primary|General|Requests)(?:, .*)?$")
_MESSAGES_TAB = re.compile(r"^direct_tab$")
_COMPOSER = re.compile(r"^row_thread_composer_edittext$")
_REQUEST_PROMPT = re.compile(r"^thread_disabled_title$")
_ACCEPT = re.compile(r"^Accept$")
_AGE = re.compile(r"^(now|\d+)([smhdw]?)$")
_DAYS_PER_UNIT = {"s": 1 / 86_400, "m": 1 / 1440, "h": 1 / 24, "d": 1, "w": 7, "": 0}
# Previews that show our side or a status instead of their latest message.
_NOT_THEIRS = re.compile(r"^(?:You:|You sent|Sent\b|Seen\b|Active\b|Typing)")
# A thread row spans the screen from its left edge and is about one avatar tall.
_ROW_HEIGHT = (150, 260)


@dataclass(frozen=True)
class InboxRow:
    name: str
    preview: str
    age_days: float | None
    unread: bool
    request: bool

    @property
    def from_them(self) -> bool:
        """Whether the preview is their message rather than ours or a status line."""
        return not _NOT_THEIRS.match(self.preview)


def read_inbox(device: EmulatorDevice, user: int, *, requests: bool) -> list[InboxRow]:
    """The newest threads in the main inbox, or in message requests, top to bottom.

    Scrolls until the oldest row is past ``max_thread_age_days`` or the list ends.
    """
    _open_list(device, user, requests=requests)
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
    """Open the thread with ``name`` from the main inbox, or from requests if it is there.

    A request moves to the main inbox once accepted, so both lists are searched.
    """
    for requests in (False, True):
        _open_list(device, user, requests=requests)
        for _scroll in range(CONTROL.inbox_scrolls + 1):
            row = next((node for node in _row_nodes(device.screen()) if _name(node) == name), None)
            if row is not None:
                device.tap(row)
                device.wait_for(re.compile(f"{_COMPOSER.pattern}|{_REQUEST_PROMPT.pattern}"))
                device.pause()
                return
            device.scroll_down()
    raise EmulatorError("The DM thread is no longer in the inbox")


def accept_request(device: EmulatorDevice) -> None:
    """Accept the open message request, if it is one, so the thread can be answered."""
    if device.find(_REQUEST_PROMPT) is None:
        return
    device.tap_when(_ACCEPT)
    device.wait_for(_COMPOSER)
    device.pause()


def _open_list(device: EmulatorDevice, user: int, *, requests: bool) -> None:
    device.open_instagram(user, INBOX_URL)
    try:
        device.wait_for(_TABS)
    except EmulatorError:
        # Right after an account switch the link can land before the app is ready;
        # the Messages tab always leads to the inbox.
        device.tap_when(_MESSAGES_TAB)
        device.wait_for(_TABS)
    device.pause()
    if requests:
        device.tap_when(_REQUESTS_TAB)
        device.pause()


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
