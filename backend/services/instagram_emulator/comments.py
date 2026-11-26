"""Read, like and pin the comments on one of a school account's posts in the Instagram app.

The notification agent's ``ig comments``, ``ig like-comment`` and ``ig pin-comment`` work
here. A post's comments open in a sheet from its Comment button; each comment's row
names its author on its avatar ("View <name>'s story" or "Profile picture of <name>")
and has a Like button at its right. Pinning is in the menu a long press on the comment
opens. Instagram keeps at most three comments pinned on a post, so a pin past that is
refused here, before anything is tapped.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from services.instagram_emulator.audio import open_post
from services.instagram_emulator.device import EmulatorDevice, EmulatorError, Node, labels

_COMMENT = re.compile(r"^Comment$")
_COMMENTS_TITLE = re.compile(r"^Comments$")
_AUTHOR = re.compile(
    r"^(?:View (?P<story>[a-z0-9._]{1,30})'s story|Profile picture of (?P<picture>[a-z0-9._]{1,30}))$"
)
_LIKE = re.compile(r"^(?:Like|Tap to like comment)$")
_LIKED = re.compile(r"^(?:Unlike|Liked|Tap to unlike comment)$")
_PIN = labels("Pin comment", "Pin")
_PINNED = labels("Pinned")
_LONG_PRESS_MS = 800
# How far above and below its author's avatar a comment's controls and labels sit.
_ROW_REACH = 50
# Instagram keeps at most this many comments pinned on one post.
PIN_LIMIT = 3


class PinLimitReached(EmulatorError):
    """The post already has as many pinned comments as Instagram allows."""


@dataclass(frozen=True)
class Comment:
    author: str
    liked: bool
    pinned: bool
    # The row and its Like button, as the screen showed them.
    row: Node
    like: Node | None


def read_comments(device: EmulatorDevice, user: int, permalink: str) -> list[Comment]:
    """The comments the post's sheet shows, top to bottom."""
    open_post(device, user, permalink)
    device.tap_when(_COMMENT)
    device.wait_for(_COMMENTS_TITLE)
    return _comments(device.screen())


def like_comment(device: EmulatorDevice, user: int, permalink: str, author: str) -> bool:
    """Like the author's newest comment on the post; False when it was liked already."""
    comment = _find(read_comments(device, user, permalink), author)
    if comment.liked:
        return False
    if comment.like is None:
        raise EmulatorError("The comment's Like button is not on screen")
    device.tap(comment.like)
    if device.watch(lambda nodes: _find(_comments(nodes), author).liked) is None:
        raise EmulatorError("Instagram did not show the comment as liked")
    return True


def pin_comment(device: EmulatorDevice, user: int, permalink: str, author: str) -> bool:
    """Pin the author's newest comment on the post; False when it was pinned already.

    Raises ``PinLimitReached`` when the post already has its three pinned comments.
    """
    comments = read_comments(device, user, permalink)
    comment = _find(comments, author)
    if comment.pinned:
        return False
    if sum(1 for other in comments if other.pinned) >= PIN_LIMIT:
        raise PinLimitReached(f"This post already has {PIN_LIMIT} pinned comments")
    device.tap(comment.row, hold_ms=_LONG_PRESS_MS)
    device.tap_when(_PIN)
    if device.watch(lambda nodes: _find(_comments(nodes), author).pinned) is None:
        raise EmulatorError("Instagram did not show the comment as pinned")
    return True


def _find(comments: list[Comment], author: str) -> Comment:
    wanted = author.strip().lstrip("@").casefold()
    mine = [comment for comment in comments if comment.author == wanted]
    if not mine:
        raise EmulatorError(f"No comment by {wanted} is on screen")
    return mine[-1]


def _comments(nodes: list[Node]) -> list[Comment]:
    """Each comment row: its author's avatar, with its Like button and Pinned label beside it."""
    found = []
    avatars = [(node, _AUTHOR.match(node.label)) for node in nodes]
    for avatar, match in avatars:
        if match is None:
            continue
        top, bottom = avatar.bounds[1] - _ROW_REACH, avatar.bounds[3] + _ROW_REACH

        def beside(node: Node, top: int = top, bottom: int = bottom) -> bool:
            return node.bounds[1] <= bottom and node.bounds[3] >= top

        row = next(
            (
                node
                for node in nodes
                if beside(node) and node.bounds[0] > avatar.bounds[2] and node.label
            ),
            avatar,
        )
        like = next((node for node in nodes if beside(node) and node.labelled(_LIKE)), None)
        liked = any(beside(node) and node.labelled(_LIKED) for node in nodes)
        pinned = any(beside(node) and node.labelled(_PINNED) for node in nodes)
        found.append(
            Comment(
                author=(match["story"] or match["picture"]).casefold(),
                liked=liked,
                pinned=pinned,
                row=row,
                like=like,
            )
        )
    return found
