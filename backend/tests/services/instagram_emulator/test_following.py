import pytest

from services.instagram_emulator import following as module
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node
from services.instagram_emulator.following import (
    ActionBlocked,
    FollowingReader,
    FollowingRow,
    FollowOutcome,
)


def _node(text="", description="", resource_id="", top=0, bottom=100):
    return Node(text, description, (0, top, 1080, bottom), resource_id)


HOME = [_node(description="Home")]


def _profile(username, *, following="90following", button="Follow"):
    nodes = [
        _node(username, resource_id="action_bar_title"),
        _node(description=following, resource_id="profile_header_following_stacked_familiar"),
        _node(button, f"{button} {username}", "profile_header_follow_button"),
    ]
    # Only a followed public profile has a bell in its top bar.
    return (
        nodes + [_node(description="Open notification settings")]
        if button == "Following"
        else nodes
    )


SEARCH_FIELD = [_node("Search", resource_id="row_search_edit_text")]


def _list(*rows):
    nodes = list(SEARCH_FIELD)
    for index, (username, label, name) in enumerate(rows):
        top = 600 + index * 200
        nodes.append(_node(username, resource_id="follow_list_username", top=top, bottom=top + 50))
        nodes.append(
            _node(label, f"{label} {name}", "follow_list_row_large_follow_button", top, top + 90)
        )
    return nodes


def _bell(posts_value):
    return [
        _node(description="Posts", resource_id="context_menu_item", top=391, bottom=549),
        _node("Posts", resource_id="context_menu_item_label", top=423, bottom=476),
        _node(posts_value, resource_id="context_menu_item_sub_label", top=476, bottom=517),
    ]


class _Device(EmulatorDevice):
    """Shows each screen in turn, moving on after every action that changes the app."""

    def __init__(self, screens):
        clock = iter(range(0, 10_000))
        super().__init__(sleep=lambda _seconds: None, monotonic=lambda: next(clock))
        self.screens = list(screens)
        self.actions = []

    def adb(self, *args):
        return ""

    def screen(self):
        return self.screens[0]

    def _advance(self, action):
        self.actions.append(action)
        if len(self.screens) > 1:
            self.screens.pop(0)

    def tap(self, node, *, hold_ms=0):
        self._advance(node.text or node.description or node.resource_id)

    def type_text(self, text):
        self._advance(f"type {text}")

    def scroll_down(self):
        self._advance("scroll")

    def back(self):
        self._advance("back")

    def open_instagram(self, user, url=None):
        self._advance(url)


@pytest.fixture(autouse=True)
def fake_clock(monkeypatch):
    """Waits pass instantly: each look at the clock is a second later than the last."""
    seconds = iter(range(0, 100_000))
    monkeypatch.setattr(module.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(module.time, "monotonic", lambda: next(seconds))


def _reader(device):
    return FollowingReader(device, 0, profile_wait_seconds=30, max_scrolls=5)


def test_search_reads_who_we_follow_and_who_we_dont_across_scrolls() -> None:
    first = _list(("utmmsa", "Message", "UTM MSA"), ("utmaclub", "Follow", "UTMAC"))
    second = _list(("utmaclub", "Follow", "UTMAC"), ("utmpadel", "Follow back", "UTM Padel"))
    device = _Device([HOME, _profile("seed"), SEARCH_FIELD, SEARCH_FIELD, first, second])

    rows = _reader(device).search_following("seed", ["utm"])

    assert rows == [
        FollowingRow("utmmsa", "UTM MSA", True),
        FollowingRow("utmaclub", "UTMAC", False),
        FollowingRow("utmpadel", "UTM Padel", False),
    ]
    assert "type utm" in device.actions


def test_search_reopens_the_list_for_each_name() -> None:
    rows = _list(("uoftchess", "Follow", "UofT Chess"))
    device = _Device(
        [
            HOME,
            _profile("seed"),
            SEARCH_FIELD,
            SEARCH_FIELD,
            rows,
            rows,
            _profile("seed"),
            SEARCH_FIELD,
            SEARCH_FIELD,
            rows,
        ]
    )

    _reader(device).search_following("seed", ["utm", "uoft"])

    assert device.actions.count("instagram://user?username=seed") == 2


def test_a_private_profile_has_no_list_to_read() -> None:
    device = _Device([HOME, [_node("This account is private")]])

    assert _reader(device).search_following("seed", ["utm"]) is None


def test_an_account_following_nobody_has_nothing_to_search() -> None:
    device = _Device([HOME, _profile("seed", following="0following")])

    assert _reader(device).search_following("seed", ["utm"]) == []


def test_a_profile_that_never_loads_raises() -> None:
    device = _Device([HOME, [_node("Loading")]])

    with pytest.raises(EmulatorError):
        _reader(device).search_following("seed", ["utm"])


def test_following_turns_post_notifications_to_all() -> None:
    following = _profile("utmaclub", button="Following")
    device = _Device(
        [
            HOME,
            _profile("utmaclub"),
            following,
            _bell("Most relevant"),
            [_node("All")],
            following,
            _bell("All"),
            following,
        ]
    )

    assert _reader(device).follow("utmaclub") == FollowOutcome("Following", tapped=True)
    assert device.actions[1:] == [
        "Follow",
        "Open notification settings",
        "Posts",
        "All",
        "Open notification settings",
        "back",
    ]


def test_an_account_already_on_all_is_left_alone() -> None:
    following = _profile("utmmsa", button="Following")
    device = _Device([HOME, following, _bell("All"), following])

    assert _reader(device).follow("utmmsa") == FollowOutcome("Following", tapped=False)
    assert device.actions[1:] == ["Open notification settings", "back"]


def test_a_private_account_is_requested_without_touching_its_bell() -> None:
    device = _Device([HOME, _profile("private.club"), _profile("private.club", button="Requested")])

    assert _reader(device).follow("private.club") == FollowOutcome("Requested", tapped=True)
    assert "Open notification settings" not in device.actions


def test_try_again_later_stops_the_account() -> None:
    device = _Device([HOME, _profile("utmaclub"), [_node("Try Again Later"), _node("OK")]])

    with pytest.raises(ActionBlocked):
        _reader(device).follow("utmaclub")
