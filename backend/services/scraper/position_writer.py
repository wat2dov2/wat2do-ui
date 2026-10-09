"""Persist hiring positions extracted from Instagram posts."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from postgrest.exceptions import APIError
from pydantic import ValidationError as PydanticValidationError

from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_SOURCE_URL_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.database import get_sb
from core.exceptions import ValidationError
from core.sanitize import remove_surrogates
from core.tables import POSITIONS
from schemas.position import PositionCreate, PositionFields
from services import school_service
from services.event_feed_revalidation import event_feed_revalidation_service
from services.scraper.org_resolve import ResolvedClub

log = logging.getLogger(__name__)

_UPDATE_FIELDS = tuple(field for field in PositionFields.model_fields if field != "title")
_RAW_POSITION_FIELDS = frozenset(
    (
        *PositionFields.model_fields,
        "id",
        "club_id",
        "school_id",
        "cohost_club_ids",
        "source_url",
        "source_image_url",
        "source_video_url",
        "ingestion_source",
        "is_active",
        "added_at",
        "updated_at",
    )
)


def write_position(
    position: dict,
    *,
    ig_handle: str,
    source_url: str,
    resolved_org: ResolvedClub,
    expected_position: dict | None = None,
) -> str:
    """Insert a role or atomically update an explicitly reviewed existing row."""
    if not isinstance(position, dict):
        raise ValidationError("Position payload must be an object")
    if position.get("id") is not None or expected_position is not None:
        return _write_reviewed_position(
            position,
            ig_handle=ig_handle,
            source_url=source_url,
            resolved_org=resolved_org,
            expected_position=expected_position,
        )
    title = (position.get("title") or "").strip()
    description = (position.get("description") or "").strip()
    school_slug = (position.get("school") or "").strip()
    school = school_service.get_school(school_slug)

    if not title or not description or not source_url:
        log.warning(
            "[%s] dropping position - missing title, description, or source URL",
            ig_handle,
        )
        return "skipped"
    if school is None:
        log.warning("[%s] dropping position %r - school is not registered", ig_handle, title)
        return "skipped"
    if not isinstance(resolved_org.club_id, int):
        log.warning("[%s] dropping position %r - club was not resolved", ig_handle, title)
        return "skipped"

    row = {
        **_position_fields(position),
        "club_id": resolved_org.club_id,
        "cohost_club_ids": list(resolved_org.cohost_club_ids),
        "school_id": school.id,
        "source_url": remove_surrogates(source_url[:MAX_POSITION_SOURCE_URL_LENGTH]),
        "source_image_url": _clean_optional(
            position.get("source_image_url"), MAX_POSITION_SOURCE_URL_LENGTH
        ),
        "source_video_url": _clean_optional(
            position.get("source_video_url"), MAX_POSITION_SOURCE_URL_LENGTH
        ),
        "ingestion_source": "instagram_scraper",
    }

    try:
        inserted = get_sb().table(POSITIONS).insert(row).execute()
    except APIError as e:
        if getattr(e, "code", None) == "23505":
            log.info("[%s] skipping duplicate position %r", ig_handle, title)
            return "skipped"
        raise

    if not inserted.data:
        log.error("[%s] positions insert returned no row for %r", ig_handle, title)
        return "skipped"

    log.info(
        "[%s] inserted position id=%s for %r",
        ig_handle,
        inserted.data[0].get("id"),
        title,
    )
    event_feed_revalidation_service.revalidate_school(school.slug, resources=("positions", "clubs"))
    return "inserted"


def normalize_position_update(position: dict, *, expected_position: dict | None) -> dict:
    """Normalize an approved update while retaining the complete raw baseline.

    The baseline must come from a fresh table ``select(*)``, outside extraction.
    Omitted role fields retain their prior values; identity and media never change.
    ``updated_at`` remains the baseline value here and is assigned by the RPC.
    """
    if (
        not isinstance(position, dict)
        or not isinstance(expected_position, dict)
        or expected_position.keys() != _RAW_POSITION_FIELDS
        or not position.keys() <= _RAW_POSITION_FIELDS | {"school", "club", "image_index"}
        or type(position.get("id")) is not int
        or position["id"] <= 0
        or type(expected_position.get("id")) is not int
        or position["id"] != expected_position["id"]
        or any(
            type(expected_position[key]) is not int or expected_position[key] <= 0
            for key in ("club_id", "school_id")
        )
        or type(expected_position["is_active"]) is not bool
        or not isinstance(expected_position["cohost_club_ids"], list)
        or any(
            type(value) is not int or value <= 0 for value in expected_position["cohost_club_ids"]
        )
        or _aware_datetime(expected_position["added_at"]) is None
        or _aware_datetime(expected_position["updated_at"]) is None
        or any(
            key in position and not _position_value_matches(key, position[key], value)
            for key, value in expected_position.items()
            if key not in _UPDATE_FIELDS
        )
    ):
        raise ValidationError("Reviewed position update requires a complete matching baseline")

    supplied = {key: position[key] for key in _UPDATE_FIELDS if key in position}
    candidate = {**expected_position, **supplied}
    if (
        not isinstance(candidate["requirements"], list)
        or any(not isinstance(value, str) for value in candidate["requirements"])
        or any(not isinstance(candidate[key], str) for key in ("title", "description"))
        or any(
            candidate[key] is not None and not isinstance(candidate[key], str)
            for key in ("commitment", "compensation", "location", "contact_email")
        )
        or candidate["is_paid"] is not None
        and type(candidate["is_paid"]) is not bool
    ):
        raise ValidationError("Reviewed position update has invalid role fields")
    try:
        PositionCreate.model_validate(
            {
                **{key: expected_position[key] for key in PositionFields.model_fields},
                "club_id": expected_position["club_id"],
                "source_url": expected_position["source_url"],
                "source_image_url": expected_position["source_image_url"],
            }
        )
        validated = PositionCreate.model_validate(
            {
                **_position_fields(candidate),
                "club_id": expected_position["club_id"],
                "source_url": expected_position["source_url"],
                "source_image_url": expected_position["source_image_url"],
            }
        )
    except (PydanticValidationError, TypeError, ValueError):
        raise ValidationError("Reviewed position update has invalid role fields") from None

    normalized = dict(expected_position)
    fields = validated.model_dump(mode="json")
    if validated.deadline_at is not None:
        fields["deadline_at"] = validated.deadline_at.astimezone(timezone.utc).isoformat()
    for key in supplied:
        if not _position_value_matches(key, fields[key], expected_position[key]):
            normalized[key] = fields[key]
    if normalized == expected_position:
        raise ValidationError("Reviewed position update contains no changes")
    return normalized


def _write_reviewed_position(
    position: dict,
    *,
    ig_handle: str,
    source_url: str,
    resolved_org: ResolvedClub,
    expected_position: dict | None,
) -> str:
    proposed = normalize_position_update(position, expected_position=expected_position)
    assert expected_position is not None
    school_slug = position.get("school")
    school = school_service.get_school(school_slug) if isinstance(school_slug, str) else None
    if (
        school is None
        or school.id != expected_position["school_id"]
        or type(resolved_org.club_id) is not int
        or resolved_org.club_id != expected_position["club_id"]
        or not isinstance(source_url, str)
        or not source_url.strip()
    ):
        raise ValidationError("Reviewed position update has mismatched source ownership")
    patch = {
        key: proposed[key] for key in _UPDATE_FIELDS if proposed[key] != expected_position[key]
    }
    updated = (
        get_sb()
        .rpc(
            "update_reviewed_position",
            {
                "p_position_id": expected_position["id"],
                "p_expected_position": expected_position,
                "p_position_patch": patch,
            },
        )
        .execute()
    )
    rows = updated.data
    baseline_updated_at = _aware_datetime(expected_position["updated_at"])
    assert baseline_updated_at is not None
    if (
        not isinstance(rows, list)
        or len(rows) != 1
        or not isinstance(rows[0], dict)
        or rows[0].keys() != proposed.keys()
        or any(
            not _position_value_matches(key, value, rows[0][key])
            for key, value in proposed.items()
            if key != "updated_at"
        )
        or (updated_at := _aware_datetime(rows[0]["updated_at"])) is None
        or updated_at <= baseline_updated_at
    ):
        raise ValidationError("Reviewed position update did not return the bound full row")
    log.info("[%s] updated reviewed position id=%s", ig_handle, expected_position["id"])
    event_feed_revalidation_service.revalidate_school(school.slug, resources=("positions", "clubs"))
    return "updated"


def _position_fields(position: dict) -> dict:
    requirements: list[str] = []
    for requirement in position.get("requirements") or []:
        cleaned = _clean_optional(requirement, MAX_POSITION_REQUIREMENT_LENGTH)
        if cleaned:
            requirements.append(cleaned)
        if len(requirements) >= MAX_POSITION_REQUIREMENT_COUNT:
            break
    return {
        "title": (position.get("title") or "").strip()[:MAX_POSITION_TITLE_LENGTH],
        "description": (position.get("description") or "").strip()[
            :MAX_POSITION_DESCRIPTION_LENGTH
        ],
        "position_type": position.get("position_type"),
        "requirements": requirements,
        "commitment": _clean_optional(position.get("commitment"), MAX_POSITION_DETAIL_LENGTH),
        "compensation": _clean_optional(position.get("compensation"), MAX_POSITION_DETAIL_LENGTH),
        "is_paid": position.get("is_paid"),
        "location": _clean_optional(position.get("location"), MAX_POSITION_DETAIL_LENGTH),
        "contact_email": _clean_optional(position.get("contact_email"), 320),
        "deadline_date": position.get("deadline_date"),
        "deadline_at": position.get("deadline_at"),
    }


def _aware_datetime(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        return parsed if parsed.tzinfo is not None else None
    except ValueError:
        return None


def _position_value_matches(key: str, left: object, right: object) -> bool:
    if key == "deadline_at" and left is not None and right is not None:
        return _aware_datetime(left) is not None and _aware_datetime(left) == _aware_datetime(right)
    if type(left) is not type(right):
        return False
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(
            _position_value_matches("", first, second) for first, second in zip(left, right)
        )
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(
            _position_value_matches("", value, right[name]) for name, value in left.items()
        )
    return left == right


def _clean_optional(value: object, max_length: int) -> str | None:
    cleaned = remove_surrogates(str(value).strip()) if value is not None else None
    return cleaned[:max_length] if cleaned else None
