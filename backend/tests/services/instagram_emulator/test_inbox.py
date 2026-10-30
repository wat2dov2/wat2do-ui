import pytest

from services.instagram_emulator import inbox
from services.instagram_emulator.device import Node


def _node(text, bounds, resource_id="", description=""):
    return Node(text, description, bounds, resource_id)


def _row(top, description, *texts):
    """One thread row as the app draws it: a full-width label, then its text lines."""
    nodes = [_node("", (0, top, 1080, top + 199), description=description)]
    for index, text in enumerate(texts):
        nodes.append(_node(text, (237, top + 40 + index * 44, 877, top + 84 + index * 44)))
    return nodes


# wat2do.yorku's inbox on 2026-10-22: tabs, then an unread request-style row and others.
INBOX = [
    _node("", (42, 879, 216, 963), description="All, 1 unread message"),
    _node("", (728, 879, 1049, 963), description="Requests, 2 unread messages"),
    *_row(
        984,
        "kurdyork, unread, Hello!! Would you share our event? ·, 2w",
        "kurdyork",
        "Hello!! Would you share our event? ·",
        "‎2w",
    ),
    *_row(1183, "spihc.waterloo, Sent 1h ago", "spihc.waterloo", "Sent 1h ago"),
    *_row(1382, "erica, might be worth a try ·, 3d", "erica", "might be worth a try ·", "3d"),
    *_row(1581, "Tony Qiu, You: Sure! ·, 5h", "Tony Qiu", "You: Sure! ·", "5h"),
]


def test_rows_read_name_preview_age_and_unread() -> None:
    rows = inbox._rows(INBOX, request=False)
    assert [(r.name, r.preview, r.age_days, r.unread) for r in rows] == [
        ("kurdyork", "Hello!! Would you share our event?", 14, True),
        ("spihc.waterloo", "Sent 1h ago", None, False),
        ("erica", "might be worth a try", 3, False),
        ("Tony Qiu", "You: Sure!", pytest.approx(5 / 24), False),
    ]
    assert [r.ours for r in rows] == [False, True, False, True]


def test_tabs_and_notes_are_not_rows() -> None:
    assert [inbox._name(row) for row in inbox._row_nodes(INBOX)] == [
        "kurdyork",
        "spihc.waterloo",
        "erica",
        "Tony Qiu",
    ]


def test_ages_read_every_unit() -> None:
    assert inbox._age_days("now") == 0
    assert inbox._age_days("30m") == pytest.approx(30 / 1440)
    assert inbox._age_days("2w") == 14
    assert inbox._age_days("Active") is None


class _AcceptingDevice:
    """A request thread whose Accept asks which inbox to move it to."""

    def __init__(self, asks_inbox):
        self.screens = [
            [_node("", (42, 1956, 1038, 2003), "thread_disabled_title")],
            [_node("Primary", (238, 1201, 842, 1329), "igds_alert_dialog_primary_button")]
            if asks_inbox
            else [_node("Message…", (158, 2185, 621, 2316), "row_thread_composer_edittext")],
            [_node("Message…", (158, 2185, 621, 2316), "row_thread_composer_edittext")],
        ]
        self.tapped = []

    def find(self, pattern, nodes=None):
        return next((n for n in self.screens[0] if n.labelled(pattern)), None)

    def wait_for(self, pattern):
        self.screens.pop(0)
        return next(n for n in self.screens[0] if n.labelled(pattern))

    def tap_when(self, pattern):
        self.tapped.append(pattern.pattern)

    def tap(self, node):
        self.tapped.append(node.resource_id)

    def pause(self):
        pass


@pytest.mark.parametrize("asks_inbox", [True, False])
def test_accepting_a_request_moves_it_to_primary_when_asked(asks_inbox) -> None:
    device = _AcceptingDevice(asks_inbox)
    inbox.accept_request(device)
    expected = ["^Accept$", "igds_alert_dialog_primary_button"] if asks_inbox else ["^Accept$"]
    assert device.tapped == expected


def test_a_limited_account_is_not_taken_for_a_request() -> None:
    # wat2do.ualberta's threads on 2026-10-29, where the composer would be.
    device = _AcceptingDevice(asks_inbox=False)
    device.screens[0] = [
        _node(
            "You can't send messages at this time", (42, 1992, 1038, 2039), "thread_disabled_title"
        )
    ]
    with pytest.raises(inbox.MessagingLimited):
        inbox.accept_request(device)
    assert device.tapped == []


class _InboxDevice:
    """One inbox screen, with or without a Requests link."""

    def __init__(self, screen):
        self.screen_nodes = screen
        self.tapped = []

    def open_inbox(self, user):
        return "wat2do.queensu"

    def screen(self):
        return self.screen_nodes

    def find(self, pattern, nodes=None):
        return next((n for n in self.screen_nodes if n.labelled(pattern)), None)

    def tap(self, node):
        self.tapped.append(node.description)

    def pause(self):
        pass

    def scroll_down(self):
        pass


# wat2do.queensu's short inbox on 2026-10-25: one thread, no tabs and no Requests link.
SHORT_INBOX = _row(
    880,
    "ESAQ, Thanks a lot for featuring our event ·, 3d",
    "ESAQ",
    "Thanks a lot for featuring our event ·",
    "3d",
)


def test_a_short_inbox_without_tabs_is_read_and_has_no_requests() -> None:
    device = _InboxDevice(SHORT_INBOX)
    assert [row.name for row in inbox.read_inbox(device, 0, requests=False)] == ["ESAQ"]
    assert inbox.read_inbox(device, 0, requests=True) == []
    assert device.tapped == []


def test_requests_are_opened_from_their_link_when_there_is_one() -> None:
    device = _InboxDevice(INBOX)
    inbox.read_inbox(device, 0, requests=True)
    assert device.tapped == ["Requests, 2 unread messages"]
