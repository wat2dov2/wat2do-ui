from contextlib import nullcontext

import pytest

from services.instagram_emulator import audio as module
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node

POST = "https://www.instagram.com/p/ABC123/"


def _screen(*labels):
    return [
        Node("", "", (0, 0, 100, 100), label.removeprefix("#"))
        if label.startswith("#")
        else Node(label, "", (0, 0, 100, 100))
        for label in labels
    ]


INBOX = [Node("wat2do.uwaterloo", "", (0, 0, 100, 100), "igds_action_bar_title")]
POST_PAGE = _screen("More actions for this post", "Like")
MENU = _screen("Archive", "Edit", "Delete")
EDIT_INFO = _screen("Edit info", "Done", "Tag people")
EDIT_INFO_AUDIO = _screen("Edit info", "Done", "Add audio")
SUGGESTIONS = _screen("Search...", "For you", "Select track Timeless by The Weeknd,4:16")
NO_MATCH = _screen("Clear text", "Lyrics", "Select track Hours by Someone Else,2:00")
RESULTS = _screen(
    "Clear text",
    "Lyrics",
    "Select track After Hours (Live) by The Weeknd,4:27",
    "Select track After Hours by The Weeknd,6:01",
)
CLIP = _screen("30 second clip", "#action_bar_button_action")
EDITED = _screen("Edit info", "Done", "After Hours")
DISCARD = _screen("Discard changes?", "Discard", "Cancel")


class _Device(EmulatorDevice):
    """Shows each screen in turn, moving on after every tap, typed text or opened post."""

    def __init__(self, screens):
        clock = iter(range(0, 10_000))
        super().__init__(sleep=lambda _seconds: None, monotonic=lambda: next(clock))
        self.screens = list(screens)
        self.taps = []
        self.typed = []

    def adb(self, *args):
        return "0\n" if args[:3] == ("shell", "am", "get-current-user") else ""

    def screen(self):
        return self.screens[0]

    def _advance(self):
        if len(self.screens) > 1:
            self.screens.pop(0)

    def tap(self, node, *, hold_ms=0):
        self.taps.append(node.text or node.resource_id)
        self._advance()

    def type_text(self, text):
        self.typed.append(text)
        self._advance()

    def scroll_down(self):
        self._advance()

    def back(self):
        self.taps.append("back")
        self._advance()

    def open_instagram(self, user, url=None):
        if url is not None:
            self._advance()


@pytest.fixture
def screens(monkeypatch):
    def use(*sequence):
        device = _Device(sequence)
        monkeypatch.setattr(module, "EmulatorDevice", lambda: device)
        monkeypatch.setattr(module, "exclusive", nullcontext)
        return device

    return use


def test_tries_songs_until_one_matches_then_saves_the_post(screens) -> None:
    device = screens(
        INBOX,
        INBOX,
        POST_PAGE,
        MENU,
        EDIT_INFO,
        EDIT_INFO_AUDIO,
        SUGGESTIONS,
        SUGGESTIONS,
        NO_MATCH,
        SUGGESTIONS,
        RESULTS,
        CLIP,
        EDITED,
        POST_PAGE,
    )
    seen = []

    def choose(query, tracks):
        seen.append((query, list(tracks)))
        return 1 if query == "the weeknd after hours" else None

    added = module.add_audio(
        "uwaterloo", "wat2do.uwaterloo", POST, ["Beyoncé  halo", "the weeknd after hours"], choose
    )
    assert added == module.AddedTrack("the weeknd after hours", "After Hours by The Weeknd,6:01")
    assert device.typed == ["Beyonce halo", "the weeknd after hours"]
    assert seen[1][1] == ["After Hours (Live) by The Weeknd,4:27", "After Hours by The Weeknd,6:01"]
    assert device.taps == [
        "More actions for this post",
        "Edit",
        "Add audio",
        "Search...",
        "Clear text",
        "Select track After Hours by The Weeknd,6:01",
        "action_bar_button_action",
        "Done",
    ]


def test_no_matching_song_discards_the_edit(screens) -> None:
    device = screens(
        INBOX,
        INBOX,
        POST_PAGE,
        MENU,
        EDIT_INFO_AUDIO,
        SUGGESTIONS,
        NO_MATCH,
        NO_MATCH,
        DISCARD,
        POST_PAGE,
    )
    with pytest.raises(module.SongNotFound):
        module.add_audio("uwaterloo", "wat2do.uwaterloo", POST, ["halo"], lambda *_: None)
    assert device.taps[-2:] == ["back", "Discard"]
    assert "Done" not in device.taps


def test_a_school_without_an_emulator_account_is_refused(screens) -> None:
    device = screens(INBOX)
    with pytest.raises(EmulatorError, match="not logged in"):
        module.add_audio("not-a-school", "wat2do.x", POST, ["halo"], lambda *_: 0)
    assert device.taps == []


@pytest.mark.parametrize(
    "url", ["https://www.instagram.com/reel/ABC/", "https://evil.example/p/ABC/", POST + "x"]
)
def test_only_exact_post_urls_get_audio(screens, url) -> None:
    device = screens(INBOX)
    with pytest.raises(EmulatorError, match="exact Instagram post"):
        module.add_audio("uwaterloo", "wat2do.uwaterloo", url, ["halo"], lambda *_: 0)
    assert device.taps == []
