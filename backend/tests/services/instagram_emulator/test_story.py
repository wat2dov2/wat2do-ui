import pytest

from services.instagram_emulator import story as module
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node

POST = "https://www.instagram.com/p/ABC123/"


def _node(label):
    return Node(label, "", (0, 0, 100, 100))


def _screen(*labels):
    return [_node(label) for label in labels]


HOME_OTHER = _screen("wat2do.utsc's story, 0 of 3", "Home", "Profile")
SWITCHER = _screen("wat2do.utsc", "wat2do.ubc", "Add Instagram account")
HOME_UBC = _screen("wat2do.ubc's story, 0 of 3", "Home", "Profile")
POST_PAGE = _screen("Profile picture of club", "Send post. Button.", "Like")
SHARE_SHEET = _screen("Search", "Add to story", "Copy link")
CAMERA_PROMPT = _screen("Allow Instagram to take pictures?", "While using the app")
EDITOR = _screen("Add a caption…", "Your story", "Close Friends")


class _Device(EmulatorDevice):
    """Shows each screen in turn, moving on after every tap or opened post."""

    def __init__(self, screens):
        clock = iter(range(0, 10_000))
        super().__init__(sleep=lambda _seconds: None, monotonic=lambda: next(clock))
        self.screens = list(screens)
        self.taps = []

    def adb(self, *args):
        return "12\n" if args[:3] == ("shell", "am", "get-current-user") else ""

    def screen(self):
        return self.screens[0]

    def tap(self, node, *, hold_ms=0):
        self.taps.append(node.text)
        if len(self.screens) > 1:
            self.screens.pop(0)

    def open_instagram(self, user, url=None):
        if url is not None:
            self.screens.pop(0)


@pytest.fixture
def screens(monkeypatch):
    devices = []

    def use(*sequence):
        device = _Device(sequence)
        devices.append(device)
        monkeypatch.setattr(module, "EmulatorDevice", lambda: device)
        return device

    return use


def test_switches_account_then_posts_the_shared_post_to_the_story(screens) -> None:
    device = screens(
        HOME_OTHER,
        HOME_OTHER,
        SWITCHER,
        HOME_UBC,
        POST_PAGE,
        SHARE_SHEET,
        CAMERA_PROMPT,
        EDITOR,
        POST_PAGE,
    )
    module.share_to_story("columbia", "wat2do.ubc", POST)
    assert device.taps == [
        "Home",
        "Profile",
        "wat2do.ubc",
        "Send post. Button.",
        "Add to story",
        "While using the app",
        "Your story",
    ]


def test_an_editor_that_never_closes_is_not_reported_as_posted(screens) -> None:
    screens(HOME_UBC, HOME_UBC, POST_PAGE, SHARE_SHEET, EDITOR, EDITOR)
    with pytest.raises(EmulatorError, match="kept showing"):
        module.share_to_story("columbia", "wat2do.ubc", POST)


def test_a_school_without_an_emulator_account_is_refused(screens) -> None:
    device = screens(HOME_UBC)
    with pytest.raises(EmulatorError, match="not logged in"):
        module.share_to_story("not-a-school", "wat2do.ubc", POST)
    assert device.taps == []


@pytest.mark.parametrize(
    "url",
    ["https://www.instagram.com/stories/club/1/", "https://evil.example/p/ABC/", POST + "x"],
)
def test_only_exact_post_urls_are_shared(screens, url) -> None:
    device = screens(HOME_UBC)
    with pytest.raises(EmulatorError, match="exact Instagram post"):
        module.share_to_story("columbia", "wat2do.ubc", url)
    assert device.taps == []
