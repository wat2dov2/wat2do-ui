"""Share a club's post or reel to a school account's story from the Instagram app.

Instagram's website cannot add someone else's post to a story, so the app on the
emulator does it the way a person would: open the post, Share, Add to story, then
post to "Your story". A carousel's story also gets a "Featured" sticker in the
post's top-right corner (``sticker``): a gallery photo added as a photo sticker.
"""

from __future__ import annotations

import re
from pathlib import Path

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
# Where the sticker's middle goes from the post's top-right corner: over its top edge,
# inside its right edge. The sticker's picture is ~300 px wide on the 1080 px screen.
_STICKER_FROM_CORNER = (-160, 40)
_STICKER_TOLERANCE = 60
# A drag can leave the sticker short of the corner; the next one starts where it stopped.
_DRAGS = 3


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
    for _ in range(_DRAGS):
        device.drag(placed, target)
        nodes = device.screen()
        if _placed_at(nodes, post, target) is not None:
            return
        placed = _added(nodes, post) or placed
    raise EmulatorError("The photo sticker did not move to the post's corner")


def _added(nodes: list[Node], post: Node) -> Node | None:
    return next(
        (node for node in nodes if node.labelled(_ON_STORY) and node.bounds != post.bounds),
        None,
    )


def _placed_at(nodes: list[Node], post: Node, target: tuple[int, int]) -> Node | None:
    node = _added(nodes, post)
    if node is None:
        return None
    x1, y1, x2, y2 = node.bounds
    off = max(abs((x1 + x2) // 2 - target[0]), abs((y1 + y2) // 2 - target[1]))
    return node if off <= _STICKER_TOLERANCE else None
