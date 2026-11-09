"""Share a club's post or reel to a school account's story from the Instagram app.

Instagram's website cannot add someone else's post to a story, so the app on the
emulator does it the way a person would: open the post, Share, Add to story, then
post to "Your story".
"""

from __future__ import annotations

import re

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


def share_to_story(device: EmulatorDevice, school: str, media_url: str) -> None:
    """Post ``media_url`` to the school's story, or raise without knowing it was not posted.

    The worker has already switched the app to the school's account and holds the lock.
    """
    if not _POST_URL.fullmatch(media_url):
        raise EmulatorError("Only an exact Instagram post or reel can go to a story")
    user = CONTROL.android_user_by_school[school]
    device.open_instagram(user, media_url)
    device.tap_when(_SHARE)
    device.tap_when(_ADD_TO_STORY)
    _open_story_editor(device)
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
