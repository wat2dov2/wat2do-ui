"""The Rust services mirror a few backend constants; keep the two in step."""

import math
import re
from pathlib import Path

from core.constants import (
    BUCKET_CLUB_LOGOS,
    BUCKET_EVENT_IMAGES,
    BUCKET_EVENT_VIDEOS,
    CLUB_CATEGORIES,
    CLUB_TYPE_INDEPENDENT,
    DEFAULT_LIST_LIMIT,
    DEFAULT_PAGE_SIZE,
    EVENT_CATEGORIES,
    INTEREST_TO_CATEGORIES,
    MAX_AVATAR_SIZE_BYTES,
    MAX_AVATAR_URL_LENGTH,
    MAX_CLUB_CATEGORY_COUNT,
    MAX_CLUB_CATEGORY_LENGTH,
    MAX_CLUB_NAME_LENGTH,
    MAX_CLUB_TYPE_LENGTH,
    MAX_EVENT_DESCRIPTION_LENGTH,
    MAX_FACULTY_LENGTH,
    MAX_FULL_NAME_LENGTH,
    MAX_INTEREST_LENGTH,
    MAX_INTERESTS_COUNT,
    MAX_LIST_LIMIT,
    MAX_PAGE_NUMBER,
    MAX_PAGE_SIZE,
    MAX_REJECTION_REASON_LENGTH,
    MAX_SCHOOL_LENGTH,
    MAX_SEARCH_QUERY_LENGTH,
    MAX_URL_LENGTH,
    NOTIFICATION_STATUS_FAILED,
    NOTIFICATION_STATUS_SENT,
    NOTIFICATION_TYPE_EVENT_CHANGE,
    NOTIFICATION_TYPE_EVENT_REMINDER,
    NOTIFICATION_TYPE_MORNING_EMAIL,
    REPORT_STATUSES,
)
from core.constants.positions import MAX_POSITION_DESCRIPTION_LENGTH

RUST_CONSTANTS = Path(__file__).resolve().parents[2] / "rust/src/constants.rs"


def _rust_value(name: str) -> str:
    match = re.search(rf"pub const {name}: [^=]+= (.+?);", RUST_CONSTANTS.read_text(), re.S)
    assert match, f"{name} is missing from rust/src/constants.rs"
    return match.group(1)


def test_event_categories_match_in_order():
    assert re.findall(r'"([^"]+)"', _rust_value("EVENT_CATEGORIES")) == list(EVENT_CATEGORIES)


def test_club_and_meta_constants_match_in_order():
    assert _rust_value("CLUB_CATEGORIES") == "EVENT_CATEGORIES"
    assert CLUB_CATEGORIES == EVENT_CATEGORIES
    assert re.findall(r'"([^"]+)"', _rust_value("REPORT_STATUSES")) == list(REPORT_STATUSES)
    pairs = re.findall(r'\("([^"]+)", &\[([^\]]*)\]\)', _rust_value("INTEREST_TO_CATEGORIES"))
    assert [(interest, re.findall(r'"([^"]+)"', targets)) for interest, targets in pairs] == list(
        INTEREST_TO_CATEGORIES.items()
    )
    assert _rust_value("CLUB_TYPE_INDEPENDENT") == f'"{CLUB_TYPE_INDEPENDENT}"'


def test_request_limits_match():
    for name, value in (
        ("MAX_FULL_NAME_LENGTH", MAX_FULL_NAME_LENGTH),
        ("MAX_FACULTY_LENGTH", MAX_FACULTY_LENGTH),
        ("MAX_SCHOOL_LENGTH", MAX_SCHOOL_LENGTH),
        ("MAX_INTEREST_LENGTH", MAX_INTEREST_LENGTH),
        ("MAX_INTERESTS_COUNT", MAX_INTERESTS_COUNT),
        ("MAX_REJECTION_REASON_LENGTH", MAX_REJECTION_REASON_LENGTH),
        ("MAX_AVATAR_URL_LENGTH", MAX_AVATAR_URL_LENGTH),
        ("MAX_URL_LENGTH", MAX_URL_LENGTH),
        ("MAX_SEARCH_QUERY_LENGTH", MAX_SEARCH_QUERY_LENGTH),
        ("MAX_CLUB_TYPE_LENGTH", MAX_CLUB_TYPE_LENGTH),
        ("MAX_CLUB_CATEGORY_LENGTH", MAX_CLUB_CATEGORY_LENGTH),
        ("MAX_CLUB_CATEGORY_COUNT", MAX_CLUB_CATEGORY_COUNT),
    ):
        assert int(_rust_value(name)) == value, name
    assert (
        int(_rust_value("MAX_LIST_LIMIT").replace("_", "")) == MAX_LIST_LIMIT == DEFAULT_LIST_LIMIT
    )


def test_limits_and_buckets_match():
    assert int(_rust_value("MAX_EVENT_DESCRIPTION_LENGTH")) == MAX_EVENT_DESCRIPTION_LENGTH
    assert int(_rust_value("MAX_POSITION_DESCRIPTION_LENGTH")) == MAX_POSITION_DESCRIPTION_LENGTH
    assert int(_rust_value("MAX_CLUB_NAME_LENGTH")) == MAX_CLUB_NAME_LENGTH
    avatar = math.prod(int(factor) for factor in _rust_value("MAX_AVATAR_SIZE_BYTES").split("*"))
    assert avatar == MAX_AVATAR_SIZE_BYTES
    assert _rust_value("BUCKET_EVENT_IMAGES") == f'"{BUCKET_EVENT_IMAGES}"'
    assert _rust_value("BUCKET_EVENT_VIDEOS") == f'"{BUCKET_EVENT_VIDEOS}"'
    assert _rust_value("BUCKET_CLUB_LOGOS") == f'"{BUCKET_CLUB_LOGOS}"'
    assert int(_rust_value("DEFAULT_PAGE_SIZE")) == DEFAULT_PAGE_SIZE
    assert int(_rust_value("MAX_PAGE_SIZE")) == MAX_PAGE_SIZE
    assert int(_rust_value("MAX_PAGE_NUMBER")) == MAX_PAGE_NUMBER


def test_notification_types_and_statuses_match():
    for name, value in (
        ("NOTIFICATION_TYPE_MORNING_EMAIL", NOTIFICATION_TYPE_MORNING_EMAIL),
        ("NOTIFICATION_TYPE_EVENT_REMINDER", NOTIFICATION_TYPE_EVENT_REMINDER),
        ("NOTIFICATION_TYPE_EVENT_CHANGE", NOTIFICATION_TYPE_EVENT_CHANGE),
        ("NOTIFICATION_STATUS_SENT", NOTIFICATION_STATUS_SENT),
        ("NOTIFICATION_STATUS_FAILED", NOTIFICATION_STATUS_FAILED),
    ):
        assert _rust_value(name) == f'"{value}"'


RUST_MESSAGES = Path(__file__).resolve().parents[2] / "rust/src/api/messages.rs"


def _rust_string(literal: str) -> str:
    return re.sub(r"\\u\{([0-9a-fA-F]+)\}", lambda match: chr(int(match.group(1), 16)), literal)


def test_error_messages_match_core_errors():
    from core import errors

    source = RUST_MESSAGES.read_text()
    messages = re.findall(r'pub const ([A-Z_]+): &str = "((?:[^"\\]|\\.)*)";', source)
    assert messages
    for name, literal in messages:
        assert _rust_string(literal) == getattr(errors, name), name
    pg_codes = re.findall(r'\("(\d+)", (\d+), "([^"]+)"\)', source)
    assert {code: (int(status), detail) for code, status, detail in pg_codes} == (
        errors.PG_CODE_TO_HTTP
    )
