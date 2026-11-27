import io
from pathlib import Path

import pytest
from PIL import Image

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
        # Whether each network check finds Android online, check by check.
        self.network = iter(())
        self.taps = []
        self.photos = []
        self.drags = []

    def adb(self, *args):
        return "12\n" if args[:3] == ("shell", "am", "get-current-user") else ""

    def screen(self):
        return self.screens[0]

    def has_network(self):
        return next(self.network, True)

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


def test_nothing_is_shared_while_the_emulator_is_offline(screens) -> None:
    device = screens(HOME, POST_PAGE, SHARE_SHEET, EDITOR, POST_PAGE)
    device.network = iter([False])
    with pytest.raises(EmulatorError, match="no network, so nothing was shared"):
        module.share_to_story(device, "columbia", POST)
    assert device.taps == []


def test_a_story_posted_as_the_network_drops_is_not_reported_as_posted(screens) -> None:
    # Offline, the editor closes all the same and the story stays on the phone.
    device = screens(HOME, POST_PAGE, SHARE_SHEET, EDITOR, POST_PAGE)
    device.network = iter([True, False])
    with pytest.raises(EmulatorError, match="may not have gone up"):
        module.share_to_story(device, "columbia", POST)
    assert device.taps[-1] == "Your story"


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


def test_a_sticker_left_short_of_the_corner_is_dragged_again_from_where_it_stopped(
    screens,
) -> None:
    # 2026-11-21: the first drag stopped short of the screen's right edge, the second did
    # not move the sticker at all, and the third reached the corner.
    added = Node(PLACED, "", (270, 905, 810, 1271))
    short = Node(PLACED, "", (543, 338, 1080, 704))
    reached = Node(PLACED, "", (594, 338, 1080, 704))
    device = screens(
        HOME,
        POST_PAGE,
        SHARE_SHEET,
        _editor(),
        STICKER_TRAY,
        GALLERY,
        _editor(added),
        _editor(short),
        _editor(short),
        _editor(reached),
        POST_PAGE,
    )
    module.share_to_story(device, "uwaterloo", POST, sticker=Path("featured_sticker_en.png"))
    # The clipped right edge is put back from the size the sticker was added at.
    assert device.drags == [
        ((270, 905, 810, 1271), (902, 524)),
        ((543, 338, 1083, 704), (902, 524)),
        ((543, 338, 1083, 704), (902, 524)),
    ]
    assert device.taps[-1] == "Your story"


def test_a_sticker_that_does_not_reach_the_corner_stops_the_share(screens) -> None:
    added = Node(PLACED, "", (270, 905, 810, 1271))
    device = screens(
        HOME,
        POST_PAGE,
        SHARE_SHEET,
        _editor(),
        STICKER_TRAY,
        GALLERY,
        *[_editor(added)] * (module._DRAGS + 1),
    )
    with pytest.raises(
        EmulatorError,
        match=f"did not move to the post's corner: it stopped -362, \\+564 px from it after "
        f"{module._DRAGS} drags",
    ):
        module.share_to_story(device, "uwaterloo", POST, sticker=Path("featured_sticker_en.png"))
    assert "Your story" not in device.taps


class _PhotoDevice(_Device):
    """Also answers the gallery lookup, a screenshot, and the share that opens the editor."""

    def __init__(self, screens, *, shots=(), gallery=("", "Row: 0 _id=4711\n")):
        super().__init__(screens)
        self.commands = []
        self.shots = list(shots)
        self.gallery = list(gallery)

    def adb(self, *args):
        self.commands.append(args)
        if "query" in args:
            return self.gallery.pop(0) if len(self.gallery) > 1 else self.gallery[0]
        if "android.intent.action.SEND" in args:
            self.screens.pop(0)
        return ""

    def _press(self, node, hold_ms):
        super()._press(node, hold_ms)
        self.taps[-1] = node.label

    def put_photo(self, user, photo):
        self.photos.append((user, photo.read_bytes()))
        return "milestone_story-0a1b2c3d.png"

    def screenshot(self):
        return self.shots.pop(0) if len(self.shots) > 1 else self.shots[0]


def _png(size=(1080, 2400), colour=(255, 255, 255), noisy=True):
    image = Image.new("RGB", size, colour)
    if noisy:
        for x in range(0, size[0], 7):
            for y in range(0, size[1], 11):
                image.putpixel((x, y), (0, 0, 0))
    out = io.BytesIO()
    image.save(out, format="PNG")
    return out.getvalue()


def _size(png):
    with Image.open(io.BytesIO(png)) as image:
        return image.size


def test_a_photo_goes_to_the_story_from_the_gallery(screens) -> None:
    recorded = []
    device = _PhotoDevice([HOME, EDITOR, HOME])
    module.share_photo(device, 12, b"card", before_post=lambda: recorded.append(device.taps[:]))
    assert device.photos == [(12, b"card")]
    send = next(command for command in device.commands if "android.intent.action.SEND" in command)
    assert "content://media/external/images/media/4711" in send
    assert send[-1].endswith("/com.instagram.share.handleractivity.StoryShareHandlerActivity")
    # The milestone is recorded just before Your story, never after it.
    assert recorded == [[]]
    assert device.taps == ["Your story"]


def test_a_photo_the_gallery_never_lists_is_not_shared(screens) -> None:
    device = _PhotoDevice([HOME], gallery=("",))
    with pytest.raises(EmulatorError, match="never reached the gallery"):
        module.share_photo(device, 12, b"card", before_post=lambda: pytest.fail("recorded"))
    assert not any("android.intent.action.SEND" in command for command in device.commands)


PROFILE = [
    Node("angrygooseinuw", "", (169, 128, 636, 275), "action_bar_title"),
    Node("11", "", (525, 373, 559, 427), "profile_header_familiar_followers_value"),
    Node("", "Photo by Angry Goose at Row 1, Column 1", (0, 1069, 356, 1544)),
    Node("", "Photo by Angry Goose at Row 2, Column 1", (0, 1550, 356, 2025)),
]
SUGGESTIONS = [
    *PROFILE[:2],
    Node("", "Discover people", (964, 852, 1048, 936), "row_profile_header_button_chaining"),
    Node("Discover people", "", (42, 992, 322, 1039), "similar_accounts_carousel_title"),
]


def test_the_profile_screenshot_closes_the_suggestions_and_ends_at_the_grid(screens) -> None:
    device = _PhotoDevice([HOME, SUGGESTIONS, PROFILE], shots=[_png()])
    shot = module.profile_screenshot(device, 12, "angrygooseinuw")
    assert device.taps == ["Discover people"]
    # From the top bar down to the grid's second row: no status bar, no navigation bar.
    assert _size(shot) == (1080, 2025 - 128)


POST_SCREEN = [
    Node("", "wat2do.wlu posted a carousel", (0, 275, 1080, 412), "row_feed_profile_header"),
    Node("", "Photo 1 of 10", (0, 412, 1080, 1762), "carousel_video_media_group"),
    Node("", "Like", (32, 1843, 95, 1906), "row_feed_button_like"),
    Node("21", "", (106, 1814, 143, 1935)),
    Node("", "Add to Saved", (958, 1814, 1074, 1924), "row_feed_button_save"),
    Node("wat2do.wlu Fresh events at wlu", "", (32, 1935, 1080, 2274)),
]


def test_the_post_screenshot_waits_for_the_picture_and_ends_at_the_buttons(screens) -> None:
    loading = _png(noisy=False)
    device = _PhotoDevice([HOME, POST_SCREEN], shots=[loading, loading, _png()])
    shot = module.post_screenshot(device, 12, POST)
    assert device.shots == [_png()]
    # The header to the row of buttons with the like count, not the caption.
    assert _size(shot) == (1080, 1935 - 275)


def test_a_post_picture_that_never_loads_is_not_shown(screens) -> None:
    device = _PhotoDevice([HOME, POST_SCREEN], shots=[_png(noisy=False)])
    with pytest.raises(EmulatorError, match="never loaded"):
        module.post_screenshot(device, 12, POST)
