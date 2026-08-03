"""OpenAI vision-based event extraction for scraped posts and directory pages.

Each ``image_url`` block in the user-message content is preceded by an
``{"type": "text", "text": "Image N:"}`` marker. The vision model keys off
these markers when populating ``image_index`` on extracted events; without
them carousel-image attribution is essentially random.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from openai import OpenAI
from pydantic import BaseModel, BeforeValidator, Field, model_validator

from core.config import settings
from core.constants import EVENT_CATEGORIES
from services.school_context import (
    canonical_school_key,
    current_semester_end,
    resolve_school_timezone,
)

log = logging.getLogger(__name__)

_SYSTEM_MESSAGE = (
    "You are a helpful assistant that extracts event information from social "
    "media posts. Always return valid JSON with the exact structure requested."
)


def _client() -> OpenAI | None:
    """Return a configured OpenAI client, or None if ``OPENAI_API_KEY`` is unset.

    A None return causes ``extract_events_from_post`` to log and return ``[]``.
    Dry-run does not bypass extraction; it still needs a key to call the model.
    """
    if not settings.openai_api_key:
        return None
    return OpenAI(api_key=settings.openai_api_key)


def extract_events_from_post(
    *,
    caption_text: str | None,
    image_urls: list[str] | None,
    post_created_at: datetime | None,
    school: str,
    model: str | None = None,
) -> list[dict]:
    """Extract zero-or-more events from one Instagram post.

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
        model: vision-capable OpenAI model. Defaults to
            ``settings.openai_extraction_model``.

    Returns the cleaned list of event dicts (each with title, description,
    location, occurrences, categories, image_index, etc.). Returns an
    empty list on any failure - never raises so the pipeline can keep
    processing the next post.
    """
    client = _client()
    if client is None:
        log.warning("OpenAI key not configured; skipping extraction for %s", school)
        return []

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

    user_content: list[dict] = [{"type": "text", "text": prompt}]
    valid_urls = [u for u in (image_urls or []) if u]
    # Inline ``Image N:`` text markers before each image_url block.
    # See module docstring - preserving this is a hard requirement.
    for i, url in enumerate(valid_urls):
        user_content.append({"type": "text", "text": f"Image {i}:"})
        user_content.append({"type": "image_url", "image_url": {"url": url}})

    messages = [
        {"role": "system", "content": _SYSTEM_MESSAGE},
        {"role": "user", "content": user_content},
    ]

    try:
        response = client.chat.completions.create(
            model=model or settings.openai_extraction_model,
            messages=messages,
        )
    except Exception as e:
        log.exception("OpenAI extraction call failed: %s", e)
        return []

    raw = (response.choices[0].message.content or "").strip()
    parsed = _parse_model_json(raw)

    if isinstance(parsed, dict):
        # Model occasionally returns a single event dict instead of an
        # array of one. Treat as a single-event response rather than
        # silently dropping it.
        events = [parsed]
    elif isinstance(parsed, list):
        events = parsed
    else:
        # ``null`` (the model's "no event in this post" return) falls
        # through here, as do unexpected shapes.
        events = []

    cleaned_events = []
    for e in events:
        if not isinstance(e, dict):
            continue
        try:
            cleaned_events.append(_clean_event(e))
        except ValueError:
            continue
    return cleaned_events


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
    image_list_str = (
        "\n".join(f"Image {i}: {url}" for i, url in enumerate(image_urls))
        if image_urls
        else "No images provided."
    )

    return f"""
Analyze the following Instagram caption and list of images. Extract event information if it's an event post.

School context: This post is from {school}. Use this to guide location and timezone decisions.
Current context: Today is {current_day}, {current_date}
Post was created on: {post_day}, {post_date} at {post_time}
{semester_line}
Caption: {caption_text or ""}

Images (0-indexed):
{image_list_str}

STRICT CONTENT POLICY:
- ONLY extract an event if the post is clearly announcing or describing a real-world event.
- Ideally, the post should have BOTH a specific date AND a specific start time.
- EXCEPTION: For major events (e.g., full-day, multi-day, overnight), you MAY extract the event even if a specific start time is not explicitly stated, provided there is a specific DATE or date range.
- For these major events ONLY, if no time is given, you may default the start time to 00:00 (midnight) or a logical start time implied by the context.
- DO NOT extract an event if:
    * The post is a meme, personal photo dump, or generic post with no time/place.
    * The post is inappropriate (nudity, explicit sexual content, or graphic violence).
    * There is NO mention of a date at all.
    * The post only introduces people or some topic, UNLESS there is a clear call to attend or participate in an actual event (such as a meeting, workshop, performance, or competition).

If you determine that there is NO event in the post, return the JSON value: null (not an object, not an array, just the literal null). Otherwise, return an array of JSON objects with ALL of the following fields:
{{
    "title": string,
    "description": string,
    "location": string,
    "organization": string,
    "price": number or null,
    "food": string[],
    "registration": boolean,
    "image_index": integer,
    "occurrences": [
        {{
            "dtstart_utc": string,  // UTC start "YYYY-MM-DDTHH:MM:SSZ"
            "dtend_utc": string,    // UTC end "YYYY-MM-DDTHH:MM:SSZ" or empty string if unknown
            "duration": string,     // "HH:MM:SS" or empty string if unknown
            "tz": string            // Timezone name like "{local_tz_key}"; use the post's timezone context
        }}
    ],
    "school": string,
    "category": string or null  // one of the canonical categories, or null if none fit: {categories_str}
}}

IMAGE MAPPING RULES:
- You are provided with a list of images.
- For each extracted event, identify which specific image contains the relevant details (e.g., date/time/location).
- Set "image_index" to the 0-based index of that image.
- Otherwise, set "image_index": 0.

OCCURRENCE RULES (CRITICAL):
- Every event MUST include at least one occurrence with a concrete UTC start time.
- Return explicit dates and times that correspond to events as separate entries in the occurrences array.
- DO NOT include registration, signup, RSVP, or application deadlines as occurrences.
- Do NOT infer or compress recurrence patterns. List each event date/time exactly as given.
- Always convert local times to UTC. The JSON must use ISO 8601 format with a trailing "Z" (e.g., "2025-11-05T22:00:00Z").
- If an end time is not provided, leave "dtend_utc" as an empty string.
- If duration is not explicitly available, leave "duration" as an empty string.
- Use the timezone context from the caption/image (default to "{local_tz_key}" for {school}) for the "tz" field.

ADDITIONAL RULES:
- Prioritize caption text; use image text if missing details.
- Title-case event titles.
- For "organization": this is the organization / society / faculty hosting the event. Prefer the most specific named entity from the caption or image (e.g., "UW Tea Organization"); if none is named, use the Instagram handle as a fallback.
- If year not found, infer the NEXT occurrence of that date relative to the post creation date ({post_date}). If end time < start time (e.g., 7pm-12am), set end to the next day.
- When no explicit date is found but there are relative terms like "tonight", "tomorrow", interpret these relative to the POST CREATION DATE ({post_date}).
- For location: Use the exact location as stated in the caption or image. If the location is a building or room on campus, use only that (e.g., "SLC 3223", "DC Library"). Include city/province if the event is off-campus and the address is provided.
- For price: REGISTRATION COST ONLY. Prefer non-member / general admission price if multiple are listed. Free events are 0.0. Use null if price is not mentioned.
- For food: Return an array. Use specific items when named (e.g., ["Pizza", "Bubble tea"]). Use ["Yes!"] for a generic food mention. Use [] when no food is mentioned.
- For registration: only true if there is a clear instruction to register, RSVP, or sign up.
- For description: caption text word-for-word. If empty, use image text.
- If information is not available, use empty string for strings, null for price, and false for booleans.
- Return ONLY the JSON array text, no extra commentary.
"""


def empty_str_to_none(v: object) -> object:
    if isinstance(v, str) and not v.strip():
        return None
    return v


OptionalStr = Annotated[str | None, BeforeValidator(empty_str_to_none)]
OptionalDatetime = Annotated[datetime | None, BeforeValidator(empty_str_to_none)]


class ExtractedOccurrence(BaseModel):
    dtstart_utc: datetime
    dtend_utc: OptionalDatetime = None
    duration: OptionalStr = None
    tz: OptionalStr = None


class ExtractedEvent(BaseModel):
    title: str = Field(default="")
    description: str = Field(default="")
    location: str = Field(default="")
    organization: str = Field(default="")
    price: float | None = None
    food: list[str] = Field(default_factory=list)
    registration: bool = False
    image_index: int = 0
    occurrences: list[ExtractedOccurrence] = Field(default_factory=list)
    school: str = Field(default="")
    category: str | None = None

    @model_validator(mode="after")
    def coerce_free_price(self) -> ExtractedEvent:
        if self.price is None:
            haystack = " ".join(
                str(v) for v in (self.title, self.description, " ".join(self.food)) if v
            ).lower()
            if "free" in haystack:
                self.price = 0.0
        return self

    @model_validator(mode="after")
    def sort_occurrences(self) -> ExtractedEvent:
        self.occurrences.sort(key=lambda occ: occ.dtstart_utc)
        return self


def _clean_event(event: dict) -> dict:
    """Validate and normalize one extracted event dict using Pydantic.

    Idempotent - running this twice on the same input is a no-op. The
    pipeline depends on this for safety after JSON parsing of arbitrary
    model output.
    """
    try:
        validated = ExtractedEvent.model_validate(event)
        return validated.model_dump(mode="json")
    except Exception as e:
        log.warning("Validation failed for event payload: %s", e)
        raise ValueError(f"Invalid event payload: {e}") from e
