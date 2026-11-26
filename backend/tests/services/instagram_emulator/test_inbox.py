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

    def screen(self):
        return [_node("", (168, 345, 1038, 395), "ig_text", "Search or ask Meta AI")]

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
        shown = self.screen_nodes if nodes is None else nodes
        return next((n for n in shown if n.labelled(pattern)), None)

    def tap(self, node):
        self.tapped.append(node.description)

    def pause(self):
        pass

    def scroll_down(self):
        pass

    def scroll_up(self):
        self.tapped.append("scrolled up")

    def wait_for(self, pattern):
        # The requests list's title shows once it opened, unless a prompt is in front.
        title = _node("Message requests", (189, 170, 657, 233), "action_bar_title")
        return next((n for n in self.screen_nodes if n.labelled(pattern)), title)

    def watch(self, look):
        # The requests list's title shows once it opened.
        title = _node("Message requests", (189, 170, 657, 233), "action_bar_title")
        return look(self.screen_nodes) or look([*self.screen_nodes, title])


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
    # One look up shows nothing new: the top, with no Requests link.
    assert device.tapped == ["scrolled up"]


def test_requests_are_opened_from_their_link_when_there_is_one() -> None:
    device = _InboxDevice(INBOX)
    inbox.read_inbox(device, 0, requests=True)
    assert device.tapped == ["Requests, 2 unread messages"]


# angrygooseinuw's inbox on 2026-11-25: no tabs, a "Requests (1)" link, then a privacy
# prompt before the requests show.
LINKED_INBOX = [_node("", (794, 858, 1038, 942), description="Requests (1)")]


def test_a_requests_link_with_a_count_opens_and_its_privacy_prompt_is_put_off() -> None:
    device = _InboxDevice([*LINKED_INBOX, _node("", (251, 1624, 828, 1750), description="Not now")])
    inbox.read_inbox(device, 0, requests=True)
    assert device.tapped == ["Requests (1)", "Not now"]


# wat2do.uwaterloo's inbox search for "viva" on 2026-11-25: the old chat, then accounts.
SEARCHED = [
    _node("viva", (147, 143, 833, 259), "search_bar_real_field"),
    _node("UWaterloo ViVA Club", (237, 327, 603, 374), "row_inbox_username"),
    _node("v1vaclub", (237, 374, 1043, 421), "row_inbox_digest"),
    _node("More accounts", (42, 474, 340, 600), "header_text"),
    _node("UWaterloo ViVA Club", (237, 618, 430, 665), "row_inbox_username"),
    _node("", (0, 2185, 1080, 2316), "row_thread_composer_edittext"),
]


class _SearchDevice(_InboxDevice):
    def __init__(self, found):
        super().__init__([])
        self.found = found
        self.typed = []

    def tap_when(self, pattern):
        self.tapped.append(pattern.pattern)

    def screen(self):
        return [_node("", (168, 345, 1038, 395), "ig_text", "Search or ask Meta AI")]

    def wait_for(self, pattern):
        return next((n for n in SEARCHED if n.labelled(pattern)), SEARCHED[0])

    def tap(self, node):
        self.tapped.append((node.text or node.description, node.bounds[1]))

    def type_text(self, text):
        self.typed.append(text)

    def watch(self, look):
        return look(SEARCHED if self.found else SEARCHED[3:4])


def test_an_old_thread_opens_from_the_inbox_search_only_among_chats() -> None:
    device = _SearchDevice(found=True)
    assert inbox._open_by_search(device, 0, "UWaterloo ViVA Club")
    assert device.typed == ["UWaterloo ViVA Club"]
    # The chat above "More accounts", never a suggested account below it.
    assert ("UWaterloo ViVA Club", 327) in device.tapped
    assert ("UWaterloo ViVA Club", 618) not in device.tapped
    assert not inbox._open_by_search(_SearchDevice(found=False), 0, "UWaterloo ViVA Club")


def test_an_inbox_reopened_scrolled_down_is_scrolled_back_up_to_its_requests_link() -> None:
    top = [_node("Messages", (42, 875, 244, 925)), *LINKED_INBOX]

    class _Scrolled(_InboxDevice):
        def screen(self):
            return self.screen_nodes if "scrolled up" in self.tapped else SHORT_INBOX

    device = _Scrolled(top)
    inbox.read_inbox(device, 0, requests=True)
    assert device.tapped[:2] == ["scrolled up", "Requests (1)"]


def test_the_business_chat_privacy_note_after_accepting_is_closed() -> None:
    device = _AcceptingDevice(asks_inbox=False)
    device.screens[1] = [
        _node("Business chats and your privacy", (60, 700, 1020, 780), "igds_headline_headline"),
        _node("", (956, 338, 1020, 402), description="Close"),
    ]
    inbox.accept_request(device)
    assert device.tapped == ["^Accept$", "^Close$"]


class _RequestsDevice:
    """Message requests listing usernames; each thread's header shows the display name."""

    TITLES = {
        "wat2do.mit": "Wat2Do | Sharing events @ mit",
        "wat2do.utsg": "Wat2Do | Sharing Events @ utsg",
    }

    def __init__(self):
        self.open = None
        self.entered = []

    def screen(self):
        if self.open is None:
            return [
                *_row(940, "wat2do.mit, hey could you repost this ·, 2h", "wat2do.mit"),
                *_row(1139, "wat2do.utsg, hi! can you feature ·, 1h", "wat2do.utsg"),
            ]
        return [_node(self.TITLES[self.open], (304, 156, 650, 204), "header_title")]

    def tap(self, node):
        self.open = node.description.split(", ")[0]
        self.entered.append(self.open)

    def wait_for(self, pattern):
        return _node("", (0, 0, 1, 1))

    def pause(self):
        pass

    def back(self):
        self.open = None


def test_a_request_is_found_by_the_display_name_its_thread_shows(monkeypatch) -> None:
    monkeypatch.setattr(inbox, "_open_list", lambda device, user, requests: True)
    device = _RequestsDevice()
    assert inbox._open_request_titled(device, 0, "Wat2Do | Sharing Events @ utsg")
    assert device.entered == ["wat2do.mit", "wat2do.utsg"] and device.open == "wat2do.utsg"
    device = _RequestsDevice()
    assert not inbox._open_request_titled(device, 0, "Someone Else")
    assert device.open is None
