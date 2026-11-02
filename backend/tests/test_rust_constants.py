"""The Rust services mirror a few backend constants; keep the two in step."""

import math
import re
from pathlib import Path

from core.constants import (
    BUCKET_CLUB_LOGOS,
    BUCKET_EVENT_IMAGES,
    BUCKET_EVENT_VIDEOS,
    EVENT_CATEGORIES,
    MAX_AVATAR_SIZE_BYTES,
    MAX_CLUB_NAME_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
)
from core.constants.positions import MAX_POSITION_DESCRIPTION_LENGTH

RUST_CONSTANTS = Path(__file__).resolve().parents[2] / "rust/src/constants.rs"


def _rust_value(name: str) -> str:
    match = re.search(rf"pub const {name}: [^=]+= (.+?);", RUST_CONSTANTS.read_text(), re.S)
    assert match, f"{name} is missing from rust/src/constants.rs"
    return match.group(1)


def test_event_categories_match_in_order():
    assert re.findall(r'"([^"]+)"', _rust_value("EVENT_CATEGORIES")) == list(EVENT_CATEGORIES)


def test_limits_and_buckets_match():
    assert int(_rust_value("MAX_EVENT_DESCRIPTION_LENGTH")) == MAX_EVENT_DESCRIPTION_LENGTH
    assert int(_rust_value("MAX_POSITION_DESCRIPTION_LENGTH")) == MAX_POSITION_DESCRIPTION_LENGTH
    assert int(_rust_value("MAX_CLUB_NAME_LENGTH")) == MAX_CLUB_NAME_LENGTH
    avatar = math.prod(int(factor) for factor in _rust_value("MAX_AVATAR_SIZE_BYTES").split("*"))
    assert avatar == MAX_AVATAR_SIZE_BYTES
    assert _rust_value("BUCKET_EVENT_IMAGES") == f'"{BUCKET_EVENT_IMAGES}"'
    assert _rust_value("BUCKET_EVENT_VIDEOS") == f'"{BUCKET_EVENT_VIDEOS}"'
    assert _rust_value("BUCKET_CLUB_LOGOS") == f'"{BUCKET_CLUB_LOGOS}"'
