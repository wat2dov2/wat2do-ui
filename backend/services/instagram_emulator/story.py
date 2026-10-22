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
    exclusive,
    labels,
)

_POST_URL = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/[A-Za-z0-9_-]+/$")
_SHARE = labels("Send post", "Share")
_ADD_TO_STORY = labels("Add to story")
_STORY_EDITOR = labels("Add a caption", "Close Friends")
_POST_TO_STORY = labels("Your story")
# First use of the story camera asks for these once per Android user.
_PERMISSION = labels("While using the app", "Allow all")
# Shown once per account after the first story; Wat2Do never cross-posts to Facebook.
_FACEBOOK_SHARING = labels("Share your stories to Facebook")
_NOT_NOW = re.compile(r"^Not now$")


def share_to_story(school: str, account_username: str, media_url: str) -> None:
    """Post ``media_url`` to the school's story, or raise without knowing it was not posted."""
    if not _POST_URL.fullmatch(media_url):
        raise EmulatorError("Only an exact Instagram post or reel can go to a story")
    user = CONTROL.android_user_by_school.get(school)
    if user is None:
        raise EmulatorError("This school's account is not logged in on the emulator")
    device = EmulatorDevice()
    with exclusive():
        device.wake()
        device.use_android_user(user)
        device.use_account(user, account_username)
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
    for _ in range(5):
        nodes = device.screen()
        if device.find(_STORY_EDITOR, nodes) is not None:
            return
        prompt = device.find(_PERMISSION, nodes)
        if prompt is not None:
            device.tap(prompt)
        else:
            device.pause()
    raise EmulatorError("Instagram's story editor did not open")
