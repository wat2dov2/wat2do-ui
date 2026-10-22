"""Add a song to a school's published carousel from the Instagram app.

Instagram's API publishes a carousel without music, so the app on the emulator
edits the live post the way a person would: More actions, Edit, Add audio, search
for a song, pick a track, keep the suggested clip, then Done.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from services.instagram_emulator.device import (
    CONTROL,
    EmulatorDevice,
    EmulatorError,
    Node,
    exclusive,
    labels,
)

_POST_URL = re.compile(r"^https://www\.instagram\.com/p/[A-Za-z0-9_-]+/$")
_POST_OPTIONS = labels("More actions for this post")
_EDIT = re.compile(r"^Edit$")
_EDIT_INFO = re.compile(r"^Edit info$")
_ADD_AUDIO = re.compile(r"^Add audio$")
_SEARCH = re.compile(r"^Search\.\.\.$")
_CLEAR_SEARCH = re.compile(r"^Clear text$")
# Suggestions show before a search; result filters replace them once it runs.
_SUGGESTIONS = re.compile(r"^For you$")
_RESULT_FILTERS = re.compile(r"^Lyrics$")
_TRACK = re.compile(r"^Select track (?P<label>.+)$")
_CLIP = re.compile(r"^\d+ second clip$")
_DONE = re.compile(r"^Done$")
# The clip screen's check mark is the one control Instagram leaves unlabelled.
_DISCARD = re.compile(r"^Discard$")
_MIN_ROW_HEIGHT = 45
_KEEP_CLIP = re.compile(r"^action_bar_button_action$")


class SongNotFound(EmulatorError):
    """None of the songs had a matching track in Instagram's music library."""


@dataclass(frozen=True)
class AddedTrack:
    query: str
    track: str


# Given the admin's song and the visible tracks, the index of the one they meant.
ChooseTrack = Callable[[str, Sequence[str]], int | None]


def add_audio(
    school: str,
    account_username: str,
    permalink: str,
    queries: Sequence[str],
    choose: ChooseTrack,
) -> AddedTrack:
    """Add the first song in ``queries`` that Instagram has, and return the track used."""
    if not _POST_URL.fullmatch(permalink):
        raise EmulatorError("Only an exact Instagram post can get audio")
    user = CONTROL.android_user_by_school.get(school)
    if user is None:
        raise EmulatorError("This school's account is not logged in on the emulator")
    device = EmulatorDevice()
    with exclusive():
        device.wake()
        device.use_android_user(user)
        device.use_account(user, account_username)
        device.open_instagram(user, permalink)
        device.tap_when(_POST_OPTIONS)
        device.tap_when(_EDIT)
        device.wait_for(_EDIT_INFO)
        _scroll_to(device, _ADD_AUDIO)
        device.tap_when(_ADD_AUDIO)
        try:
            added = _pick_track(device, queries, choose)
        except EmulatorError:
            # Leave without saving, so the post keeps no half-made edit.
            _discard(device)
            raise
        device.tap_when(_DONE)
        device.wait_until_gone(_EDIT_INFO, seconds=CONTROL.audio_save_wait_seconds)
        return added


def _pick_track(device: EmulatorDevice, queries: Sequence[str], choose: ChooseTrack) -> AddedTrack:
    device.tap_when(_SEARCH)
    for number, query in enumerate(queries):
        if number:
            device.tap_when(_CLEAR_SEARCH)
            device.wait_for(_SUGGESTIONS)
        device.type_text(_typeable(query))
        tracks = _results(device)
        index = choose(query, [label for label, _ in tracks]) if tracks else None
        if index is None:
            continue
        label, node = tracks[index]
        _select(device, node)
        # The clip screen opens on Instagram's suggested part of the song.
        device.tap_when(_KEEP_CLIP)
        device.wait_for(_EDIT_INFO)
        return AddedTrack(query, label)
    raise SongNotFound("Instagram had none of the songs")


def _results(device: EmulatorDevice) -> list[tuple[str, Node]]:
    device.wait_for(_RESULT_FILTERS)
    device.wait_until_gone(_SUGGESTIONS, seconds=CONTROL.screen_wait_seconds)
    device.pause()
    tracks = []
    for node in device.screen():
        match = _TRACK.match(node.description) or _TRACK.match(node.text)
        if match and match["label"] not in (label for label, _ in tracks):
            tracks.append((match["label"], node))
    return tracks


def _select(device: EmulatorDevice, track: Node) -> None:
    # With the keyboard open, the first tap only closes it.
    for _ in range(2):
        device.tap(track)
        try:
            device.wait_for(_CLIP, seconds=CONTROL.screen_wait_seconds / 2)
            return
        except EmulatorError:
            continue
    raise EmulatorError("Instagram did not open the track's clip")


def _scroll_to(device: EmulatorDevice, pattern: re.Pattern[str]) -> None:
    for _ in range(4):
        node = device.find(pattern)
        # A control cut off at the screen's edge is scrolled fully into view first.
        if node is not None and node.bounds[3] - node.bounds[1] >= _MIN_ROW_HEIGHT:
            return
        device.scroll_down()
    raise EmulatorError(f"Instagram never showed {pattern.pattern}")


def _discard(device: EmulatorDevice) -> None:
    """Back out to the post, discarding the edit when Instagram asks."""
    for _ in range(5):
        nodes = device.screen()
        prompt = device.find(_DISCARD, nodes)
        if prompt is not None:
            device.tap(prompt)
            return
        if device.find(_POST_OPTIONS, nodes) is not None:
            return
        device.back()


def _typeable(query: str) -> str:
    """Android's input command types plain ASCII only, and Instagram's search ignores accents."""
    folded = unicodedata.normalize("NFKD", query).encode("ascii", "ignore").decode()
    return " ".join(folded.split())
