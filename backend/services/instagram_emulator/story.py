"""Post to a school account's story from the Instagram app.

Instagram's website cannot add someone else's post to a story, so the app on the
emulator does it the way a person would: open the post, Share, Add to story, then
post to "Your story". A carousel's story also gets a "Featured" sticker in the
post's top-right corner (``sticker``): a gallery photo added as a photo sticker.

A picture of our own (a milestone's thank-you card) goes to the story the way a person
shares one from their gallery (``share_photo``), and ``profile_screenshot`` and
``post_screenshot`` take the screenshots such a card shows.
"""

from __future__ import annotations

import io
import re
import shlex
import tempfile
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from PIL import Image, ImageStat

from services.instagram_emulator.device import (
    CONTROL,
    EmulatorDevice,
    EmulatorError,
    Node,
    labels,
)

_POST_URL = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/[A-Za-z0-9_-]+/$")
_SHARE = labels("Send post", "Share")
_ADD_TO_STORY = labels("Add to story")
_STORY_EDITOR = labels("Add a caption", "Close Friends")
_POST_TO_STORY = labels("Your story")
# First use of the story camera asks for these once per Android user, one after another.
_PERMISSION = labels("While using the app", "Allow all")
_EDITOR_OR_PERMISSION = re.compile(f"{_STORY_EDITOR.pattern}|{_PERMISSION.pattern}")
_PERMISSIONS_ASKED = 3
# Shown once per account after the first story; Wat2Do never cross-posts to Facebook.
_FACEBOOK_SHARING = labels("Share your stories to Facebook")
_NOT_NOW = re.compile(r"^Not now$")
_STICKERS = labels("Stickers")
_PHOTO_STICKER = labels("Photo sticker")
_GALLERY_PHOTO = labels("gallery_sticker_grid_item_thumbnail")
_GALLERY_OR_PERMISSION = re.compile(f"{_GALLERY_PHOTO.pattern}|{_PERMISSION.pattern}")
# Every item on the story, the shared post first, reads this way.
_ON_STORY = labels("Sticker. Touch and hold to reposition")
# Where the sticker's middle goes from the post's top-right corner: on the corner,
# hanging over both edges. The sticker's pill is ~300 px wide on the 1080 px screen, so
# it stops short of the screen's right edge.
_STICKER_FROM_CORNER = (-70, 10)
_STICKER_TOLERANCE = 60
# A drag towards the screen's right edge can stop short of the corner, or not move the
# sticker at all; the next one starts where it stopped.
_DRAGS = 6
# Android's share target that opens a gallery picture in Instagram's story editor.
_STORY_SHARE_ACTIVITY = "com.instagram.share.handleractivity.StoryShareHandlerActivity"
_GALLERY = "content://media/external/images/media"
_STORY_PHOTO = "milestone_story.png"
# The media scanner adds a picture to the gallery a moment after it is told about it.
_GALLERY_LOOKUPS = 10
# The account's own profile: its follower count, the "Discover people" suggestions it
# can show under the buttons (closed for the screenshot), and the post grid.
_FOLLOWERS = re.compile(r"^profile_header_(?:familiar_)?followers")
_TOP_BAR = re.compile(r"^action_bar_title$")
_SUGGESTIONS = re.compile(r"^similar_accounts_carousel_title$")
_SUGGESTIONS_TOGGLE = re.compile(r"^row_profile_header_button_chaining$")
_GRID_SECOND_ROW = re.compile(r"^.* at Row 2, Column 1$")
# A post page: the post's header, then its picture, buttons and like count; the next
# post on the page starts with a header of its own.
_POST_HEADER = re.compile(r"^row_feed_profile_header$")
_LIKE = re.compile(r"^row_feed_button_like$")
_ROW_HEIGHT = 150
# A loading picture is a blank square: its grey levels spread far less than a photo's.
_LOADED_SPREAD = 12
_PICTURE_LOOKS = 15


def share_to_story(
    device: EmulatorDevice, school: str, media_url: str, *, sticker: Path | None = None
) -> None:
    """Post ``media_url`` to the school's story, or raise without knowing it was not posted.

    With ``sticker``, that picture goes on the post's top-right corner first. The worker
    has already switched the app to the school's account and holds the lock.
    """
    if not _POST_URL.fullmatch(media_url):
        raise EmulatorError("Only an exact Instagram post or reel can go to a story")
    user = CONTROL.android_user_by_school[school]
    if sticker is not None:
        device.put_photo(user, sticker)
    device.open_instagram(user, media_url)
    device.tap_when(_SHARE)
    device.tap_when(_ADD_TO_STORY)
    _open_story_editor(device)
    if sticker is not None:
        _place_sticker(device)
    device.tap_when(_POST_TO_STORY)
    _decline_facebook_sharing(device)
    # The editor closes once Instagram has taken the story for upload.
    device.wait_until_gone(_STORY_EDITOR, seconds=CONTROL.story_upload_wait_seconds)


def _decline_facebook_sharing(device: EmulatorDevice) -> None:
    device.pause()
    nodes = device.screen()
    if device.find(_FACEBOOK_SHARING, nodes) is not None:
        device.tap(_required(device.find(_NOT_NOW, nodes)))


def _required(node: Node | None) -> Node:
    if node is None:
        raise EmulatorError("Instagram's Facebook sharing prompt has no Not now button")
    return node


def _open_story_editor(device: EmulatorDevice) -> None:
    """Wait for the story editor, granting the camera what Android asks for on the way."""
    for _ in range(_PERMISSIONS_ASKED + 1):
        shown = device.wait_for(_EDITOR_OR_PERMISSION)
        if not shown.labelled(_PERMISSION):
            return
        device.tap(shown)
    raise EmulatorError("Instagram's story editor did not open")


def _place_sticker(device: EmulatorDevice) -> None:
    """Add the gallery's newest photo as a sticker and drag it onto the post's corner."""
    post = device.wait_for(_ON_STORY)
    device.tap_when(_STICKERS)
    device.tap_when(_PHOTO_STICKER)
    # Each Android user's first photo sticker asks for the gallery once.
    for _ in range(_PERMISSIONS_ASKED + 1):
        shown = device.wait_for(_GALLERY_OR_PERMISSION)
        device.tap(shown)
        if not shown.labelled(_PERMISSION):
            break
    else:
        raise EmulatorError("Instagram's gallery never opened for a photo sticker")
    placed = device.watch(lambda nodes: _added(nodes, post))
    if placed is None:
        raise EmulatorError("The photo sticker never showed on the story")
    target = (post.bounds[2] + _STICKER_FROM_CORNER[0], post.bounds[1] + _STICKER_FROM_CORNER[1])
    # The screen clips the sticker's bounds past its right edge, so its place is read
    # from its left and top edges and the size it was added at.
    width, height = placed.bounds[2] - placed.bounds[0], placed.bounds[3] - placed.bounds[1]
    for _ in range(_DRAGS):
        device.drag(placed, target)
        moved = _added(device.screen(), post)
        if moved is None:
            raise EmulatorError("The photo sticker was lost from the story while dragged")
        x1, y1 = moved.bounds[:2]
        placed = replace(moved, bounds=(x1, y1, x1 + width, y1 + height))
        off = (x1 + width // 2 - target[0], y1 + height // 2 - target[1])
        if max(abs(off[0]), abs(off[1])) <= _STICKER_TOLERANCE:
            return
    raise EmulatorError(
        f"The photo sticker did not move to the post's corner: it stopped {off[0]:+d}, "
        f"{off[1]:+d} px from it after {_DRAGS} drags"
    )


def _added(nodes: list[Node], post: Node) -> Node | None:
    return next(
        (node for node in nodes if node.labelled(_ON_STORY) and node.bounds != post.bounds),
        None,
    )


def share_photo(
    device: EmulatorDevice, user: int, photo: bytes, *, before_post: Callable[[], None]
) -> None:
    """Post the PNG ``photo`` to the account's story, or raise without knowing it was not
    posted. ``before_post`` runs just before "Your story" is tapped: a failure before it
    means the story was not posted.

    The picture becomes the gallery's newest photo and is shared to Instagram's story
    the way the gallery's Share does, which opens it in the story editor.
    """
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / _STORY_PHOTO
        path.write_bytes(photo)
        name = device.put_photo(user, path)
    device.adb(
        "shell",
        "am",
        "start",
        "--user",
        str(user),
        "-a",
        "android.intent.action.SEND",
        "-t",
        "image/png",
        "--eu",
        "android.intent.extra.STREAM",
        _gallery_uri(device, user, name),
        "-n",
        f"{CONTROL.instagram_package}/{_STORY_SHARE_ACTIVITY}",
    )
    _open_story_editor(device)
    before_post()
    device.tap_when(_POST_TO_STORY)
    _decline_facebook_sharing(device)
    device.wait_until_gone(_STORY_EDITOR, seconds=CONTROL.story_upload_wait_seconds)


def _gallery_uri(device: EmulatorDevice, user: int, name: str) -> str:
    """The gallery's address for the picture ``name``, once the media scanner added it."""
    for _ in range(_GALLERY_LOOKUPS):
        rows = device.adb(
            "shell",
            "content",
            "query",
            "--user",
            str(user),
            "--uri",
            _GALLERY,
            "--projection",
            "_id",
            "--where",
            shlex.quote(f"_display_name='{name}'"),
        )
        found = re.search(r"_id=(\d+)", rows)
        if found:
            return f"{_GALLERY}/{found[1]}"
        device.pause()
    raise EmulatorError("The story picture never reached the gallery")


def profile_screenshot(device: EmulatorDevice, user: int, username: str) -> bytes:
    """The account's own profile as PNG bytes: from its top bar to the post grid's
    second row, with Instagram's "Discover people" suggestions closed."""
    device.open_instagram(user, f"https://www.instagram.com/{username}/")
    device.wait_for(_FOLLOWERS)
    if device.find(_SUGGESTIONS) is not None:
        device.tap_when(_SUGGESTIONS_TOGGLE)
        device.wait_until_gone(_SUGGESTIONS, seconds=CONTROL.screen_wait_seconds)
    device.pause()
    nodes = device.screen()
    top = device.find(_TOP_BAR, nodes)
    if top is None:
        raise EmulatorError("The profile's top bar was not on screen")
    row = device.find(_GRID_SECOND_ROW, nodes)
    bottom = row.bounds[3] if row is not None else max(node.bounds[3] for node in nodes)
    return _crop(device.screenshot(), top.bounds[1], bottom)


def post_screenshot(device: EmulatorDevice, user: int, url: str) -> bytes:
    """The post at ``url`` as PNG bytes: its header, its picture once loaded, and its row
    of buttons with the like count."""
    if not _POST_URL.fullmatch(url):
        raise EmulatorError("Only an exact Instagram post or reel can be shown")
    device.open_instagram(user, url)
    like = device.wait_for(_LIKE)
    nodes = device.screen()
    header = device.find(_POST_HEADER, nodes)
    if header is None:
        raise EmulatorError("The post's header was not on screen")
    # The row of buttons and counts: every labelled control level with the Like button.
    middle = (like.bounds[1] + like.bounds[3]) // 2
    row = [
        node.bounds[3]
        for node in nodes
        if node.label and node.bounds[1] <= middle <= node.bounds[3] < middle + _ROW_HEIGHT
    ]
    shot = _loaded(device, (header.bounds[0], header.bounds[3], header.bounds[2], like.bounds[1]))
    return _crop(shot, header.bounds[1], max(row))


def _loaded(device: EmulatorDevice, box: tuple[int, int, int, int]) -> bytes:
    """A screenshot taken once the picture in ``box`` has loaded: until then Instagram
    draws a blank square with a spinner, which reads as nearly one colour."""
    for _ in range(_PICTURE_LOOKS):
        shot = device.screenshot()
        with Image.open(io.BytesIO(shot)) as image:
            spread = ImageStat.Stat(image.convert("L").crop(box)).stddev[0]
        if spread > _LOADED_SPREAD:
            return shot
        device.pause()
    raise EmulatorError("The post's picture never loaded")


def _crop(screenshot: bytes, top: int, bottom: int) -> bytes:
    """The screenshot's rows from ``top`` to ``bottom``, as PNG bytes."""
    with Image.open(io.BytesIO(screenshot)) as image:
        cropped = image.convert("RGB").crop((0, top, image.width, bottom))
    out = io.BytesIO()
    cropped.save(out, format="PNG")
    return out.getvalue()
