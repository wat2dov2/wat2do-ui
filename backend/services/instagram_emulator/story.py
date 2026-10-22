"""Share a club's post or reel to a school account's story from the Instagram app.

Instagram's website cannot add someone else's post to a story, so the app on the
emulator does it the way a person would: open the post, Share, Add to story, then
post to "Your story".
"""

from __future__ import annotations

import re

from services.instagram_emulator.device import CONTROL, EmulatorDevice, EmulatorError, labels

_POST_URL = re.compile(r"^https://www\.instagram\.com/(?:p|reel)/[A-Za-z0-9_-]+/$")
_HOME_TAB = re.compile(r"^Home$")
_PROFILE_TAB = re.compile(r"^Profile$")
_SHARE = labels("Send post", "Share")
_ADD_TO_STORY = labels("Add to story")
_STORY_EDITOR = labels("Add a caption", "Close Friends")
_POST_TO_STORY = labels("Your story")
# First use of the story camera asks for these once per Android user.
_PERMISSION = labels("While using the app", "Allow all")
_SAVE_LOGIN = labels("Save your login info")
_SAVE = re.compile(r"^Save$")


def share_to_story(school: str, account_username: str, media_url: str) -> None:
    """Post ``media_url`` to the school's story, or raise without knowing it was not posted."""
    if not _POST_URL.fullmatch(media_url):
        raise EmulatorError("Only an exact Instagram post or reel can go to a story")
    user = CONTROL.android_user_by_school.get(school)
    if user is None:
        raise EmulatorError("This school's account is not logged in on the emulator")
    device = EmulatorDevice()
    device.wake()
    device.use_android_user(user)
    _use_account(device, user, account_username)
    device.open_instagram(user, media_url)
    device.tap_when(_SHARE)
    device.tap_when(_ADD_TO_STORY)
    _open_story_editor(device)
    device.tap_when(_POST_TO_STORY)
    # The editor closes once Instagram has taken the story for upload.
    device.wait_until_gone(_STORY_EDITOR, seconds=CONTROL.story_upload_wait_seconds)


def _use_account(device: EmulatorDevice, user: int, account_username: str) -> None:
    """Switch the app to the account, confirmed by its own story bubble on the home feed."""
    own_story = labels(f"{account_username}'s story")
    device.open_instagram(user)
    _go_home(device)
    if device.find(own_story) is not None:
        return
    device.tap(device.wait_for(_PROFILE_TAB), hold_ms=1200)
    device.tap_when(re.compile(rf"^{re.escape(account_username)}$"))
    switched = device.wait_for(labels(f"{account_username}'s story", "Save your login info"))
    if switched.labelled(_SAVE_LOGIN):
        device.tap_when(_SAVE)
        device.wait_for(own_story)


def _go_home(device: EmulatorDevice) -> None:
    for _ in range(6):
        home = device.find(_HOME_TAB)
        if home is not None:
            device.tap(home)
            return
        device.back()
    raise EmulatorError("Instagram's home feed could not be reached")


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
