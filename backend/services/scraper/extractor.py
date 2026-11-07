"""Vision-based event and hiring extraction for scraped content.

The model call is a ``Completion``: the API uses ``openai_completion`` and the
vestigial pipeline passes a Claude completion. Every image is preceded
by an ``Image N:`` marker. The model keys off these markers when populating
``image_index``; without them carousel-image attribution is essentially random.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import date, datetime
from pathlib import Path
from typing import Annotated, Literal
from zoneinfo import ZoneInfo

from openai import OpenAI
from pydantic import BaseModel, BeforeValidator, Field, model_validator

from core.config import settings
from core.constants import EVENT_CATEGORIES
from core.constants.positions import (
    MAX_POSITION_DESCRIPTION_LENGTH,
    MAX_POSITION_DETAIL_LENGTH,
    MAX_POSITION_REQUIREMENT_COUNT,
    MAX_POSITION_REQUIREMENT_LENGTH,
    MAX_POSITION_TITLE_LENGTH,
)
from core.sanitize import normalize_scraped_text
from schemas.event import EVENT_DISCOVERY, EventDiscoveryFields
from schemas.position import PositionType
from services.event_service import normalize_campus_season_ids
from services.school_context import (
    campus_season_prompt,
    canonical_school_key,
    current_semester_end,
    resolve_school_timezone,
)

log = logging.getLogger(__name__)

_SYSTEM_MESSAGE = (
    "You triage social media posts and extract campus event and hiring information. "
    "Always return valid JSON with the exact structure requested."
)

# The prompt template (``str.format`` placeholders), shared with the Rust image
# parsing routes (rust/src/api/routes/ai), which render it the same way.
EXTRACTION_PROMPT = Path(__file__).with_name("extraction_prompt.txt").read_text(encoding="utf-8")

EVENT_DISCOVERY_JSON_FIELDS = "\n".join(
    f'"{name}": {"string[]" if name == "campus_season_ids" else "boolean"} or null,'
    for name in EventDiscoveryFields.model_fields
)
EVENT_DISCOVERY_RULES = "\n".join(
    [
        *EVENT_DISCOVERY["heading"],
        *(
            f"- {name}: {field.description}"
            for name, field in EventDiscoveryFields.model_fields.items()
        ),
    ]
)


class PostExtractionError(RuntimeError):
    """A provider or response failure that must not consume an imported post."""

    def __init__(self) -> None:
        super().__init__("Instagram post extraction failed")


Completion = Callable[[str, str, list[str]], str | None]
"""``(system, prompt, image_urls) -> response text``, or None when the call failed."""


def openai_completion(system: str, prompt: str, image_urls: list[str]) -> str | None:
    """Run one vision completion with the configured OpenAI extraction model."""
    if not settings.openai_api_key:
        log.warning("OpenAI extraction client unavailable")
        return None
    user_content: list[dict] = [{"type": "text", "text": prompt}]
    for i, url in enumerate(image_urls):
        user_content.append({"type": "text", "text": f"Image {i}:"})
        user_content.append({"type": "image_url", "image_url": {"url": url}})
    try:
        response = OpenAI(api_key=settings.openai_api_key).chat.completions.create(
            model=settings.openai_extraction_model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_content},
            ],
        )
    except Exception:
        log.warning("OpenAI extraction call failed")
        return None
    return response.choices[0].message.content or ""


def extract_post_content(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
    complete: Completion = openai_completion,
) -> ExtractedPostContent:
    """Triage content and extract zero-or-more events and hiring positions.

    Args:
        caption_text: post caption (may be empty/None for image-only posts).
        image_urls: ordered list of public image URLs (application storage
            after ``image_uploader.upload_post_images``). The list order
            corresponds to the carousel order; ``image_index`` on the
            returned events refers to this list.
        post_created_at: aware datetime of the post (used for relative
            phrases like "tonight"/"tomorrow"). Falls back to "now" in
            the school's local TZ if missing.
        school: school slug (e.g. "uwaterloo").
        complete: the vision model call; defaults to ``openai_completion``.

    Returns cleaned event and position dictionaries in one result. A valid
    non-event post may be empty; provider and unusable-response failures raise
    ``PostExtractionError`` so an importer can retry without consuming the post.
    """
    tz_name = resolve_school_timezone(school)
    try:
        local_tz = ZoneInfo(tz_name)
    except Exception:
        # resolve_school_timezone falls back to "UTC" for unknown schools
        # so this branch only fires if the IANA database is somehow missing
        # the resolved zone - paranoid fallback to UTC.
        local_tz = ZoneInfo("UTC")

    now_local = datetime.now(local_tz)
    if isinstance(post_created_at, datetime):
        if post_created_at.tzinfo is None:
            post_local = post_created_at.replace(tzinfo=local_tz)
        else:
            post_local = post_created_at.astimezone(local_tz)
    else:
        post_local = now_local

    semester_end = current_semester_end(school, now=now_local)
    semester_line = f"Current semester end date: {semester_end}\n" if semester_end else ""

    categories_str = "\n".join(f"- {cat}" for cat in EVENT_CATEGORIES)
    prompt = _build_prompt(
        caption_text=caption_text,
        image_urls=image_urls or [],
        school=canonical_school_key(school),
        local_tz_key=local_tz.key,
        current_date=now_local.strftime("%Y-%m-%d"),
        current_day=now_local.strftime("%A"),
        post_date=post_local.strftime("%Y-%m-%d"),
        post_day=post_local.strftime("%A"),
        post_time=post_local.strftime("%H:%M"),
        semester_line=semester_line,
        categories_str=categories_str,
    )

    raw = complete(_SYSTEM_MESSAGE, prompt, [u for u in (image_urls or []) if u])
    if raw is None:
        raise PostExtractionError()

    try:
        parsed = _parse_model_json(raw.strip())

        # These values belong to the source, not to model interpretation.
        if isinstance(parsed, dict):
            for key in ("events", "positions"):
                items = parsed.get(key)
                for item in items if isinstance(items, list) else []:
                    if not isinstance(item, dict):
                        continue
                    if caption_text and caption_text.strip():
                        item["description"] = (
                            caption_text[:MAX_POSITION_DESCRIPTION_LENGTH]
                            if key == "positions"
                            else caption_text
                        )
                    item["school"] = canonical_school_key(school)

        return _clean_extracted_content(parsed)
    except Exception:
        log.warning("Extraction returned an unusable response")
    # Keep upstream content out of exception context as well as the message.
    raise PostExtractionError() from None


def extract_events_from_post(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
) -> list[dict]:
    """Extract events for event-only consumers such as poster scanning."""
    return extract_post_content(
        caption_text=caption_text,
        image_urls=image_urls,
        post_created_at=post_created_at,
        school=school,
    ).events


def _parse_model_json(raw: str):
    """Parse the model's response, tolerating common formatting quirks.

    Strips ``json`` and bare ` ``` ` code fences, then attempts a strict
    parse. On failure, falls back to extracting the first JSON value
    (``[ ... ]`` or ``{ ... }``) in the string - handles the case where
    the model appended a trailing "Note: ..." sentence despite the prompt
    asking for JSON only. Returns ``None`` if nothing parses.
    """
    s = raw
    if s.startswith("```json"):
        s = s[len("```json") :]
    elif s.startswith("```"):
        s = s[3:]
    if s.endswith("```"):
        s = s[: -len("```")]
    s = s.strip()
    if not s:
        return None

    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass

    # Fallback: find the first `[` or `{` and the matching last `]` or `}`.
    for opener, closer in (("[", "]"), ("{", "}")):
        start = s.find(opener)
        end = s.rfind(closer)
        if start != -1 and end > start:
            try:
                return json.loads(s[start : end + 1])
            except json.JSONDecodeError:
                continue

    log.warning("Extractor returned non-JSON text (len=%d): %s", len(raw), raw[:200])
    return None


def _build_prompt(
    *,
    caption_text: str | None,
    image_urls: list[str],
    school: str,
    local_tz_key: str,
    current_date: str,
    current_day: str,
    post_date: str,
    post_day: str,
    post_time: str,
    semester_line: str,
    categories_str: str,
) -> str:
    """Assemble the extraction prompt.

    Kept verbose because Instagram-caption phrasing is irregular enough that
    aggressive trimming causes regressions in date inference and price parsing.
    """
    description_field = (
        '\n      "description": string,' if not caption_text or not caption_text.strip() else ""
    )
    description_rule = (
        "No caption is available. Extract description from the relevant image text; do not invent details."
        if description_field
        else "Do not output description. The application attaches the original caption to every extracted item."
    )

    return EXTRACTION_PROMPT.format(
        school=school,
        current_day=current_day,
        current_date=current_date,
        post_day=post_day,
        post_date=post_date,
        post_time=post_time,
        semester_line=semester_line,
        caption=caption_text or "",
        image_count=len([url for url in image_urls if url]),
        description_rule=description_rule,
        description_field=description_field,
        discovery_json_fields=EVENT_DISCOVERY_JSON_FIELDS,
        local_tz_key=local_tz_key,
        categories_str=categories_str,
        discovery_rules=EVENT_DISCOVERY_RULES,
        campus_seasons=campus_season_prompt(school),
    )


def empty_str_to_none(v: object) -> object:
    if isinstance(v, str) and not v.strip():
        return None
    return v


OptionalStr = Annotated[str | None, BeforeValidator(empty_str_to_none)]
OptionalDatetime = Annotated[datetime | None, BeforeValidator(empty_str_to_none)]
PostContentType = Literal["event", "hiring", "event_and_hiring", "other"]


class ExtractedOccurrence(BaseModel):
    dtstart_utc: datetime
    dtend_utc: OptionalDatetime = None
    duration: OptionalStr = None
    tz: OptionalStr = None


class ExtractedEvent(EventDiscoveryFields):
    title: str = Field(default="")
    description: str = Field(default="")
    location: str = Field(default="")
    club: str = Field(default="")
    price: float | None = None
    food: list[str] = Field(default_factory=list)
    registration: bool = False
    image_index: int = 0
    occurrences: list[ExtractedOccurrence] = Field(default_factory=list)
    school: str = Field(default="")
    category: str | None = None

    @model_validator(mode="after")
    def sort_occurrences(self) -> ExtractedEvent:
        self.occurrences.sort(key=lambda occ: occ.dtstart_utc)
        return self


class ExtractedPosition(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_POSITION_TITLE_LENGTH)
    description: str = Field(min_length=1, max_length=MAX_POSITION_DESCRIPTION_LENGTH)
    club: str = Field(default="")
    position_type: PositionType
    requirements: list[
        Annotated[str, Field(min_length=1, max_length=MAX_POSITION_REQUIREMENT_LENGTH)]
    ] = Field(default_factory=list, max_length=MAX_POSITION_REQUIREMENT_COUNT)
    commitment: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    compensation: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    is_paid: bool | None = None
    location: OptionalStr = Field(default=None, max_length=MAX_POSITION_DETAIL_LENGTH)
    contact_email: OptionalStr = Field(default=None, max_length=320)
    deadline_date: date | None = None
    deadline_at: OptionalDatetime = None
    image_index: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def deadline_time_requires_date(self) -> ExtractedPosition:
        if self.deadline_at is not None and self.deadline_date is None:
            raise ValueError("deadline_at requires deadline_date")
        if self.deadline_at is not None and self.deadline_at.tzinfo is None:
            raise ValueError("deadline_at must include a timezone")
        return self


class ExtractedPostContent(BaseModel):
    content_type: PostContentType = "other"
    events: list[dict] = Field(default_factory=list)
    positions: list[dict] = Field(default_factory=list)


def _clean_extracted_content(value: object) -> ExtractedPostContent:
    if not isinstance(value, dict):
        raise ValueError("Extractor response must contain a classified post")

    content_type = value.get("content_type")
    if content_type not in {"event", "hiring", "event_and_hiring", "other"}:
        raise ValueError("Extractor response has an invalid content type")

    events: list[dict] = []
    raw_events = value.get("events")
    if raw_events is None:
        raw_events = []
    if content_type in {"event", "event_and_hiring"}:
        if not isinstance(raw_events, list):
            raise ValueError("Extractor events must be a list")
        for event in raw_events:
            if not isinstance(event, dict):
                continue
            try:
                events.append(_clean_event(event))
            except ValueError:
                continue

    positions: list[dict] = []
    raw_positions = value.get("positions")
    if raw_positions is None:
        raw_positions = []
    if content_type in {"hiring", "event_and_hiring"}:
        if not isinstance(raw_positions, list):
            raise ValueError("Extractor positions must be a list")
        for position in raw_positions:
            if not isinstance(position, dict):
                continue
            try:
                positions.append(_clean_position(position))
            except ValueError:
                continue

    if (
        not events
        and not positions
        and (
            (content_type in {"event", "event_and_hiring"} and raw_events)
            or (content_type in {"hiring", "event_and_hiring"} and raw_positions)
        )
    ):
        raise ValueError("Extractor response contains no usable advertised items")

    return ExtractedPostContent(
        content_type=content_type,
        events=events,
        positions=positions,
    )


def _clean_event(event: dict) -> dict:
    """Validate and normalize one extracted event dict using Pydantic.

    Idempotent - running this twice on the same input is a no-op. The
    pipeline depends on this for safety after JSON parsing of arbitrary
    model output.
    """
    try:
        validated = ExtractedEvent.model_validate(
            {
                **event,
                "campus_season_ids": normalize_campus_season_ids(
                    event.get("campus_season_ids"), event.get("school")
                ),
            }
        )
        return _normalize_extracted_strings(validated.model_dump(mode="json"))
    except Exception as e:
        log.warning("Validation failed for event payload: %s", e)
        raise ValueError(f"Invalid event payload: {e}") from e


def _clean_position(position: dict) -> dict:
    """Validate and normalize one extracted hiring position."""
    try:
        validated = ExtractedPosition.model_validate(position)
        return _normalize_extracted_strings(validated.model_dump(mode="json"))
    except Exception as e:
        log.warning("Validation failed for position payload: %s", e)
        raise ValueError(f"Invalid position payload: {e}") from e


def _normalize_extracted_strings(value):
    """Normalize every textual leaf returned by the extraction model."""
    if isinstance(value, str):
        return normalize_scraped_text(value)
    if isinstance(value, list):
        return [_normalize_extracted_strings(item) for item in value]
    if isinstance(value, dict):
        return {key: _normalize_extracted_strings(item) for key, item in value.items()}
    return value
