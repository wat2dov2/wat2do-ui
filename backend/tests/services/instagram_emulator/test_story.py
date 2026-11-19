from pathlib import Path

import pytest

from services.instagram_emulator import story as module
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node

POST = "https://www.instagram.com/p/ABC123/"


def _node(label):
    return Node(label, "", (0, 0, 100, 100))


def _screen(*labels):
    return [_node(label) for label in labels]


# The screen the worker leaves the app on after switching accounts.
HOME = _screen("Home")
POST_PAGE = _screen("Profile picture of club", "Send post. Button.", "Like")
SHARE_SHEET = _screen("Search", "Add to story", "Copy link")
CAMERA_PROMPT = _screen("Allow Instagram to take pictures?", "While using the app")
EDITOR = _screen("Add a caption…", "Your story", "Close Friends")
FACEBOOK_PROMPT = _screen("Share your stories to Facebook too", "Always share stories", "Not now")


class _Device(EmulatorDevice):
    """Shows each screen in turn, moving on after every tap or opened post."""

    def __init__(self, screens):
        clock = iter(range(0, 10_000))
        super().__init__(sleep=lambda _seconds: None, monotonic=lambda: next(clock))
        self.screens = list(screens)
        self.taps = []
        self.photos = []
        self.drags = []

    def adb(self, *args):
        return "12\n" if args[:3] == ("shell", "am", "get-current-user") else ""

    def screen(self):
        return self.screens[0]

    def _press(self, node, hold_ms):
        self.taps.append(node.text)
        if len(self.screens) > 1:
            self.screens.pop(0)

    def open_instagram(self, user, url=None):
        if url is not None:
            self.screens.pop(0)

    def put_photo(self, user, photo):
        self.photos.append((user, photo.name))

    def drag(self, node, to):
        self.drags.append((node.bounds, to))
        self.screens.pop(0)


@pytest.fixture
def screens(monkeypatch):
    devices = []

    def use(*sequence):
        device = _Device(sequence)
        devices.append(device)
        return device

    return use


def test_posts_the_shared_post_to_the_story(screens) -> None:
    device = screens(HOME, POST_PAGE, SHARE_SHEET, CAMERA_PROMPT, EDITOR, POST_PAGE)
    module.share_to_story(device, "columbia", POST)
    assert device.taps == [
        "Send post. Button.",
        "Add to story",
        "While using the app",
        "Your story",
    ]


def test_the_facebook_cross_posting_prompt_is_declined(screens) -> None:
    device = screens(HOME, POST_PAGE, SHARE_SHEET, EDITOR, FACEBOOK_PROMPT, POST_PAGE)
    module.share_to_story(device, "columbia", POST)
    assert device.taps[-2:] == ["Your story", "Not now"]
    assert "Always share stories" not in device.taps


def test_an_editor_that_never_closes_is_not_reported_as_posted(screens) -> None:
    device = screens(HOME, POST_PAGE, SHARE_SHEET, EDITOR, EDITOR)
    with pytest.raises(EmulatorError, match="kept showing"):
        module.share_to_story(device, "columbia", POST)


@pytest.mark.parametrize(
    "url",
    ["https://www.instagram.com/stories/club/1/", "https://evil.example/p/ABC/", POST + "x"],
)
def test_only_exact_post_urls_are_shared(screens, url) -> None:
    device = screens(HOME)
    with pytest.raises(EmulatorError, match="exact Instagram post"):
        module.share_to_story(device, "columbia", url)
    assert device.taps == []


PLACED = "Sticker. Touch and hold to reposition. Use two fingers to rotate or resize."
POST_ON_STORY = Node(PLACED, "", (108, 514, 972, 1661))


def _editor(*extra):
    return [*EDITOR, POST_ON_STORY, _node("Stickers"), *extra]


STICKER_TRAY = _screen("Location sticker", "Photo sticker", "Cutout Sticker")
GALLERY_PROMPT = _screen("Allow Instagram to access photos?", "Allow all")
GALLERY = [Node("Photo", "", (24, 599, 348, 1211), "gallery_sticker_grid_item_thumbnail")]


def test_the_featured_sticker_goes_on_the_post_corner_before_posting(screens) -> None:
    added = Node(PLACED, "", (270, 905, 810, 1271))
    # Past the screen's right edge, its bounds are cut off there.
    moved = Node(PLACED, "", (632, 341, 1080, 707))
    device = screens(
        HOME,
        POST_PAGE,
        SHARE_SHEET,
        _editor(),
        STICKER_TRAY,
        GALLERY_PROMPT,
        GALLERY,
        _editor(added),
        _editor(moved),
        POST_PAGE,
    )
    module.share_to_story(device, "uwaterloo", POST, sticker=Path("featured_sticker_en.png"))
    assert device.photos == [(0, "featured_sticker_en.png")]
    assert device.taps == [
        "Send post. Button.",
        "Add to story",
        "Stickers",
        "Photo sticker",
        "Allow all",
        "Photo",
        "Your story",
    ]
    # On the post's top-right corner (972, 514).
    assert device.drags == [((270, 905, 810, 1271), (902, 524))]


def test_a_sticker_that_does_not_reach_the_corner_stops_the_share(screens) -> None:
    added = Node(PLACED, "", (270, 905, 810, 1271))
    device = screens(
        HOME,
        POST_PAGE,
        SHARE_SHEET,
        _editor(),
        STICKER_TRAY,
        GALLERY,
        _editor(added),
        _editor(added),
        _editor(added),
        _editor(added),
    )
    with pytest.raises(EmulatorError, match="did not move"):
        module.share_to_story(device, "uwaterloo", POST, sticker=Path("featured_sticker_en.png"))
    assert "Your story" not in device.taps
