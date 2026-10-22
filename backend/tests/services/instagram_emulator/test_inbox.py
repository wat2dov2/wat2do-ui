import pytest

from services.instagram_emulator import inbox
from services.instagram_emulator.device import Node


def _node(text, bounds, resource_id="", description=""):
    return Node(text, description, bounds, resource_id)


def _row(top, description, *texts):
    """One thread row as the app draws it: a full-width label, then its text lines."""
    nodes = [_node("", (0, top, 1080, top + 199), description=description)]
    for index, text in enumerate(texts):
        nodes.append(_node(text, (237, top + 40 + index * 44, 877, top + 84 + index * 44)))
    return nodes


# wat2do.yorku's inbox on 2026-10-22: tabs, then an unread request-style row and others.
INBOX = [
    _node("", (42, 879, 216, 963), description="All, 1 unread message"),
    _node("", (728, 879, 1049, 963), description="Requests, 2 unread messages"),
    *_row(
        984,
        "kurdyork, unread, Hello!! Would you share our event? ·, 2w",
        "kurdyork",
        "Hello!! Would you share our event? ·",
        "‎2w",
    ),
    *_row(1183, "spihc.waterloo, Sent 1h ago", "spihc.waterloo", "Sent 1h ago"),
    *_row(1382, "erica, might be worth a try ·, 3d", "erica", "might be worth a try ·", "3d"),
    *_row(1581, "Tony Qiu, You: Sure! ·, 5h", "Tony Qiu", "You: Sure! ·", "5h"),
]


def test_rows_read_name_preview_age_and_unread() -> None:
    rows = inbox._rows(INBOX, request=False)
    assert [(r.name, r.preview, r.age_days, r.unread) for r in rows] == [
        ("kurdyork", "Hello!! Would you share our event?", 14, True),
        ("spihc.waterloo", "Sent 1h ago", None, False),
        ("erica", "might be worth a try", 3, False),
        ("Tony Qiu", "You: Sure!", pytest.approx(5 / 24), False),
    ]
    assert [r.from_them for r in rows] == [True, False, True, False]


def test_tabs_and_notes_are_not_rows() -> None:
    assert [inbox._name(row) for row in inbox._row_nodes(INBOX)] == [
        "kurdyork",
        "spihc.waterloo",
        "erica",
        "Tony Qiu",
    ]


def test_ages_read_every_unit() -> None:
    assert inbox._age_days("now") == 0
    assert inbox._age_days("30m") == pytest.approx(30 / 1440)
    assert inbox._age_days("2w") == 14
    assert inbox._age_days("Active") is None
