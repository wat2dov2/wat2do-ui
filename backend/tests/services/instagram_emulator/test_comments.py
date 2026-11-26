import pytest

from services.instagram_emulator import comments as module
from services.instagram_emulator.device import Node


def _node(text, bounds, resource_id=""):
    return Node(text, "", bounds, resource_id)


# The comments sheet on wat2do.mcmaster's carousel, 2026-11-25.
SHEET = [
    _node("Comments", (262, 828, 818, 931), "title_text_view"),
    _node("View mcmasterpokerstudiesclub's story", (42, 1065, 137, 1160)),
    _node("5h", (148, 1055, 933, 1532)),
    _node("Reply", (172, 1532, 300, 1613)),
    _node("Tap to like comment", (933, 1034, 1080, 1192)),
    _node("Like", (933, 1034, 1080, 1150)),
]


def test_a_comment_is_read_with_its_author_and_like_button():
    (comment,) = module._comments(SHEET)
    assert comment.author == "mcmasterpokerstudiesclub"
    assert not comment.liked and not comment.pinned
    assert comment.like is not None and comment.row.label == "5h"


def test_a_liked_and_pinned_comment_reads_that_way():
    sheet = [
        *SHEET[:3],
        _node("Pinned", (172, 1020, 300, 1050)),
        _node("Unlike", (933, 1034, 1080, 1150)),
    ]
    (comment,) = module._comments(sheet)
    assert comment.liked and comment.pinned


class _Device:
    def __init__(self, sheet):
        self.sheet = sheet
        self.taps = []

    def screen(self):
        return self.sheet

    def tap(self, node, hold_ms=0):
        self.taps.append(node.label)


def test_a_fourth_pin_is_refused_before_anything_is_tapped(monkeypatch):
    pinned = [
        Comment
        for Comment in (module.Comment(f"club{i}", False, True, SHEET[2], None) for i in range(3))
    ]
    target = module.Comment("newclub", False, False, SHEET[2], SHEET[5])
    monkeypatch.setattr(module, "read_comments", lambda device, user, permalink: [*pinned, target])
    device = _Device(SHEET)
    with pytest.raises(module.PinLimitReached):
        module.pin_comment(device, 0, "https://www.instagram.com/p/X/", "newclub")
    assert device.taps == []
