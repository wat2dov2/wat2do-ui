"""Pass 2 LLM reconcile: turn Pass 1 extracts + DB candidates into final events.

Pass 2 returns the final event object array. Objects with an existing
integer ``id`` overwrite that row; objects without ``id`` are inserts.
Omitted candidates are left unchanged. Never deletes.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

from core.config import settings
from core.constants import EVENT_CATEGORIES
from services.scraper.dedup import confident_duplicate_id
from services.scraper.extractor import (
    ExtractedOccurrence,
    _client,
    _parse_model_json,
    empty_str_to_none,
)

log = logging.getLogger(__name__)

_SYSTEM_MESSAGE = (
    "You reconcile newly extracted events against existing database candidates. "
    "Always return valid JSON with the exact structure requested."
)

OptionalStr = Annotated[str | None, BeforeValidator(empty_str_to_none)]


class ReconciledEvent(BaseModel):
    """Final event object Pass 2 returns for upsert."""

    id: int | None = None
    title: str = Field(default="")
    description: str = Field(default="")
    location: str = Field(default="")
    club: str = Field(default="")
    price: float | None = None
    food: list[str] = Field(default_factory=list)

    @field_validator("food", mode="before")
    @classmethod
    def _coerce_null_food(cls, v: Any) -> list[str]:
        return v if v is not None else []

    registration: bool = False
    image_index: int = 0
    occurrences: list[ExtractedOccurrence] = Field(default_factory=list)
    school: str = Field(default="")
    category: str | None = None
    cancelled: bool = False
    source_image_url: OptionalStr = None
    replace_occurrences: bool = False

    @model_validator(mode="after")
    def sort_occurrences(self) -> ReconciledEvent:
        self.occurrences.sort(key=lambda occ: occ.dtstart_utc)
        return self


def reconcile_events(
    *,
    extracted_events: list[dict],
    candidates_by_index: list[list[dict]],
    caption_text: str | None,
    school: str,
    model: str | None = None,
    resolved_club_ids: list[int | None] | None = None,
    resolved_ig_handles: list[str | None] | None = None,
) -> list[dict] | None:
    """Return final event dicts for upsert, or None on failure.

    ``candidates_by_index[i]`` is the candidate list for ``extracted_events[i]``.
    On any failure the caller should fall back to insert-only Pass 1 events.
    """
    if not extracted_events:
        return []

    confident_ids = [
        confident_duplicate_id(
            event=event,
            candidates=(candidates_by_index[index] if index < len(candidates_by_index) else []),
            club_id=(
                resolved_club_ids[index]
                if resolved_club_ids is not None and index < len(resolved_club_ids)
                else None
            ),
            ig_handle=(
                resolved_ig_handles[index]
                if resolved_ig_handles is not None and index < len(resolved_ig_handles)
                else None
            ),
        )
        for index, event in enumerate(extracted_events)
    ]

    client = _client()
    if client is None:
        log.warning("OpenAI key not configured; skipping Pass 2 reconcile for %s", school)
        return _confident_match_fallback(extracted_events, confident_ids)

    prompt = _build_reconcile_prompt(
        extracted_events=extracted_events,
        candidates_by_index=candidates_by_index,
        caption_text=caption_text,
        school=school,
        resolved_club_ids=resolved_club_ids,
        resolved_ig_handles=resolved_ig_handles,
    )
    messages = [
        {"role": "system", "content": _SYSTEM_MESSAGE},
        {"role": "user", "content": prompt},
    ]

    try:
        response = client.chat.completions.create(
            model=model or settings.openai_extraction_model,
            messages=messages,
        )
    except Exception as e:
        log.exception("Pass 2 reconcile OpenAI call failed: %s", e)
        return _confident_match_fallback(extracted_events, confident_ids)

    raw = (response.choices[0].message.content or "").strip()
    parsed = _parse_model_json(raw)
    if isinstance(parsed, dict):
        events = [parsed]
    elif isinstance(parsed, list):
        events = parsed
    else:
        log.warning("Pass 2 reconcile returned non-array JSON: %r", type(parsed).__name__)
        return _confident_match_fallback(extracted_events, confident_ids)

    candidates_by_id: dict[int, dict] = {}
    for candidates in candidates_by_index:
        for c in candidates:
            cid = c.get("id")
            if isinstance(cid, int):
                candidates_by_id[cid] = c
    allowed_ids = set(candidates_by_id)

    cleaned: list[dict] = []
    for i, raw_event in enumerate(events):
        if not isinstance(raw_event, dict):
            continue
        try:
            validated = ReconciledEvent.model_validate(raw_event)
        except Exception as err:
            log.warning("Pass 2 event validation failed: %s", err)
            continue
        if len(events) == len(extracted_events) and i < len(confident_ids):
            confident_id = confident_ids[i]
            if confident_id is not None:
                validated.id = confident_id
        if validated.id is not None and validated.id not in allowed_ids:
            log.warning(
                "Pass 2 returned unknown id=%s; treating as insert",
                validated.id,
            )
            validated.id = None

        if len(events) == len(extracted_events) and i < len(extracted_events):
            if not validated.source_image_url:
                validated.source_image_url = extracted_events[i].get("source_image_url")
            if validated.image_index == 0 and "image_index" in extracted_events[i]:
                validated.image_index = extracted_events[i].get("image_index", 0)

        # Pair by index when Pass 2 returns one object per extract; otherwise
        # leave scrape org context unset for unpaired trailing objects.
        if resolved_club_ids is not None and len(events) == len(extracted_events):
            scrape_org_id = resolved_club_ids[i] if i < len(resolved_club_ids) else None
            scrape_ig = None
            if resolved_ig_handles is not None and i < len(resolved_ig_handles):
                scrape_ig = resolved_ig_handles[i]
            validated.id = _guard_cross_org_id(
                validated.id,
                candidates_by_id=candidates_by_id,
                scrape_club_id=scrape_org_id,
                scrape_ig_handle=scrape_ig,
            )

        if not validated.occurrences:
            log.warning("Pass 2 event %r has no occurrences; dropping", validated.title)
            continue
        cleaned.append(validated.model_dump(mode="json"))

    if not cleaned and extracted_events:
        log.warning("Pass 2 produced zero valid events; caller should fall back")
        return _confident_match_fallback(extracted_events, confident_ids)
    return cleaned


def _confident_match_fallback(
    extracted_events: list[dict],
    confident_ids: list[int | None],
) -> list[dict] | None:
    """Preserve deterministic duplicate IDs when the gray-zone model fails."""
    if not any(event_id is not None for event_id in confident_ids):
        return None

    fallback: list[dict] = []
    for index, event in enumerate(extracted_events):
        event_id = confident_ids[index] if index < len(confident_ids) else None
        try:
            validated = ReconciledEvent.model_validate(
                {
                    **event,
                    "id": event_id,
                    "replace_occurrences": False,
                }
            )
        except Exception as err:
            log.warning("Deterministic reconcile fallback validation failed: %s", err)
            continue
        fallback.append(validated.model_dump(mode="json"))
    return fallback or None


def _guard_cross_org_id(
    event_id: int | None,
    *,
    candidates_by_id: dict[int, dict],
    scrape_club_id: int | None,
    scrape_ig_handle: str | None,
) -> int | None:
    """Strip overwrite ids that would cross club ownership."""
    if event_id is None:
        return None
    candidate = candidates_by_id.get(event_id)
    if candidate is None:
        return None

    cand_org = candidate.get("club_id")
    cand_ig = (candidate.get("ig_handle") or "").strip().lstrip("@") or None
    scrape_ig = (scrape_ig_handle or "").strip().lstrip("@") or None

    if isinstance(scrape_club_id, int) and isinstance(cand_org, int):
        if scrape_club_id != cand_org:
            log.warning(
                "Pass 2 cross-org id=%s stripped (scrape_org=%s cand_org=%s)",
                event_id,
                scrape_club_id,
                cand_org,
            )
            return None
        return event_id

    # Scrape org unresolved: only allow overwrite when ig_handle matches.
    if scrape_club_id is None and isinstance(cand_org, int):
        if scrape_ig and cand_ig and scrape_ig == cand_ig:
            return event_id
        log.warning(
            "Pass 2 id=%s stripped - candidate org_id=%s but scrape org unresolved/no ig match",
            event_id,
            cand_org,
        )
        return None

    return event_id


def _build_reconcile_prompt(
    *,
    extracted_events: list[dict],
    candidates_by_index: list[list[dict]],
    caption_text: str | None,
    school: str,
    resolved_club_ids: list[int | None] | None = None,
    resolved_ig_handles: list[str | None] | None = None,
) -> str:
    categories_str = ", ".join(EVENT_CATEGORIES)
    pairs = []
    for i, extracted in enumerate(extracted_events):
        candidates = candidates_by_index[i] if i < len(candidates_by_index) else []
        scrape_org_id = None
        scrape_ig = None
        if resolved_club_ids is not None and i < len(resolved_club_ids):
            scrape_org_id = resolved_club_ids[i]
        if resolved_ig_handles is not None and i < len(resolved_ig_handles):
            scrape_ig = resolved_ig_handles[i]
        pairs.append(
            {
                "extracted": extracted,
                "scrape_club_id": scrape_org_id,
                "scrape_ig_handle": scrape_ig,
                "confident_duplicate_id": confident_duplicate_id(
                    event=extracted,
                    candidates=candidates,
                    club_id=scrape_org_id,
                    ig_handle=scrape_ig,
                ),
                "candidates": candidates,
            }
        )

    return f"""
You are reconciling newly extracted campus events against existing database candidates.

School: {school}
Caption (source of truth for update/cancel intent):
{caption_text or ""}

Input pairs (JSON):
{json.dumps(pairs, default=str)}

Return a JSON array of FINAL event objects that should be written to the database.
Each object must use this shape:
{{
  "id": integer or null,
  "title": string,
  "description": string,
  "location": string,
  "club": string,
  "price": number or null,
  "food": string[],
  "registration": boolean,
  "image_index": integer,
  "occurrences": [
    {{
      "dtstart_utc": string,
      "dtend_utc": string or null,
      "duration": string or null,
      "tz": string or null
    }}
  ],
  "school": string,
  "category": string or null,  // one of: {categories_str}
  "cancelled": boolean,
  "source_image_url": string or null,
  "replace_occurrences": boolean
}}

RULES:
- When `confident_duplicate_id` is an integer, use that exact id. Deterministic title, location, club, and occurrence checks have already established identity.
- Reuse a candidate id when it is the same logical event from the same club: the attendee activity and at least one occurrence must strongly match, and the caption must not indicate a distinct new occurrence. Compare each extracted `occurrences[].dtstart_utc` against each candidate `occurrences[].dtstart_utc`. This applies to a normal repost, reminder, secondary flyer, performer reveal, or ticket reminder even when it does not say "update".
- Treat matching titles alone as insufficient. Insert when the candidate is absent, the activity is materially different, or the caption/date makes clear this is a distinct occurrence, session, edition, or new week. If no candidate `occurrences[].dtstart_utc` exactly matches an extracted occurrence after UTC normalization, id MUST be null, even for the same title, club, and location.
- Same club_id + strong activity and occurrence match: prefer overwrite/link. Updated, moved, corrected, rescheduled, and cancelled posts also overwrite/link the matching candidate.
- Different club_id: never overwrite; always insert (id=null).
- Only set "id" to a candidate id from the matching extracted event's provided candidates. Never link two merely similar recurring events just to avoid an insert.
- If the caption says the event is cancelled / canceled, return the matched candidate object with "cancelled": true and keep other fields from the candidate unless the caption also corrects them. Cancel requires an id.
- New overlapping fields from the extracted event win, including a shorter description.
- Set `replace_occurrences` to false for ordinary reposts, reminders, cancellations, and partial details. Set it to true only when the source explicitly replaces or reschedules the complete occurrence schedule.
- Rebuild "occurrences" correctly from the new source. The writer preserves unmentioned existing occurrences unless `replace_occurrences` is true.
- Only use an "id" that appears in the provided candidates for that extracted event.
- Candidates include club_id, club, and ig_handle - use them for ownership decisions.
- Omitted candidates are left unchanged. Never delete. Never merge two existing database events into one.
- Return ONLY the JSON array text, no commentary.
""".strip()
