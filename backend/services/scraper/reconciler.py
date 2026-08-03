"""Pass 2 LLM reconcile: turn Pass 1 extracts + DB candidates into final events.

Pass 2 returns the final event object array. Objects with an existing
integer ``id`` overwrite that row; objects without ``id`` are inserts.
Omitted candidates are left unchanged. Never deletes.
"""

from __future__ import annotations

import json
import logging
from typing import Annotated, Any

from openai import OpenAI
from pydantic import BaseModel, BeforeValidator, Field, field_validator, model_validator

from core.config import settings
from core.constants import EVENT_CATEGORIES
from services.scraper.extractor import (
    ExtractedOccurrence,
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
    organization: str = Field(default="")
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

    @model_validator(mode="after")
    def sort_occurrences(self) -> ReconciledEvent:
        self.occurrences.sort(key=lambda occ: occ.dtstart_utc)
        return self


def _client() -> OpenAI | None:
    if not settings.openai_api_key:
        return None
    return OpenAI(api_key=settings.openai_api_key)


def reconcile_events(
    *,
    extracted_events: list[dict],
    candidates_by_index: list[list[dict]],
    caption_text: str | None,
    school: str,
    model: str | None = None,
    resolved_organization_ids: list[int | None] | None = None,
    resolved_ig_handles: list[str | None] | None = None,
) -> list[dict] | None:
    """Return final event dicts for upsert, or None on failure.

    ``candidates_by_index[i]`` is the candidate list for ``extracted_events[i]``.
    On any failure the caller should fall back to insert-only Pass 1 events.
    """
    if not extracted_events:
        return []

    client = _client()
    if client is None:
        log.warning("OpenAI key not configured; skipping Pass 2 reconcile for %s", school)
        return None

    prompt = _build_reconcile_prompt(
        extracted_events=extracted_events,
        candidates_by_index=candidates_by_index,
        caption_text=caption_text,
        school=school,
        resolved_organization_ids=resolved_organization_ids,
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
        return None

    raw = (response.choices[0].message.content or "").strip()
    parsed = _parse_model_json(raw)
    if isinstance(parsed, dict):
        events = [parsed]
    elif isinstance(parsed, list):
        events = parsed
    else:
        log.warning("Pass 2 reconcile returned non-array JSON: %r", type(parsed).__name__)
        return None

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
        if validated.id is not None and validated.id not in allowed_ids:
            log.warning(
                "Pass 2 returned unknown id=%s; treating as insert",
                validated.id,
            )
            validated.id = None

        # Pair by index when Pass 2 returns one object per extract; otherwise
        # leave scrape org context unset for unpaired trailing objects.
        if resolved_organization_ids is not None and len(events) == len(extracted_events):
            scrape_org_id = (
                resolved_organization_ids[i] if i < len(resolved_organization_ids) else None
            )
            scrape_ig = None
            if resolved_ig_handles is not None and i < len(resolved_ig_handles):
                scrape_ig = resolved_ig_handles[i]
            validated.id = _guard_cross_org_id(
                validated.id,
                candidates_by_id=candidates_by_id,
                scrape_organization_id=scrape_org_id,
                scrape_ig_handle=scrape_ig,
            )

        if not validated.occurrences:
            log.warning("Pass 2 event %r has no occurrences; dropping", validated.title)
            continue
        cleaned.append(validated.model_dump(mode="json"))

    if not cleaned and extracted_events:
        log.warning("Pass 2 produced zero valid events; caller should fall back")
        return None
    return cleaned


def _guard_cross_org_id(
    event_id: int | None,
    *,
    candidates_by_id: dict[int, dict],
    scrape_organization_id: int | None,
    scrape_ig_handle: str | None,
) -> int | None:
    """Strip overwrite ids that would cross organization ownership."""
    if event_id is None:
        return None
    candidate = candidates_by_id.get(event_id)
    if candidate is None:
        return None

    cand_org = candidate.get("organization_id")
    cand_ig = (candidate.get("ig_handle") or "").strip().lstrip("@") or None
    scrape_ig = (scrape_ig_handle or "").strip().lstrip("@") or None

    if isinstance(scrape_organization_id, int) and isinstance(cand_org, int):
        if scrape_organization_id != cand_org:
            log.warning(
                "Pass 2 cross-org id=%s stripped (scrape_org=%s cand_org=%s)",
                event_id,
                scrape_organization_id,
                cand_org,
            )
            return None
        return event_id

    # Legacy: scrape has org_id, candidate null org but matching ig_handle.
    if isinstance(scrape_organization_id, int) and cand_org is None:
        if scrape_ig and cand_ig and scrape_ig == cand_ig:
            return event_id
        log.warning(
            "Pass 2 id=%s stripped - scrape org_id=%s but candidate has no org/ig match",
            event_id,
            scrape_organization_id,
        )
        return None

    # Scrape org unresolved: only allow overwrite when ig_handle matches.
    if scrape_organization_id is None and isinstance(cand_org, int):
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
    resolved_organization_ids: list[int | None] | None = None,
    resolved_ig_handles: list[str | None] | None = None,
) -> str:
    categories_str = ", ".join(EVENT_CATEGORIES)
    pairs = []
    for i, extracted in enumerate(extracted_events):
        candidates = candidates_by_index[i] if i < len(candidates_by_index) else []
        scrape_org_id = None
        scrape_ig = None
        if resolved_organization_ids is not None and i < len(resolved_organization_ids):
            scrape_org_id = resolved_organization_ids[i]
        if resolved_ig_handles is not None and i < len(resolved_ig_handles):
            scrape_ig = resolved_ig_handles[i]
        pairs.append(
            {
                "extracted": extracted,
                "scrape_organization_id": scrape_org_id,
                "scrape_ig_handle": scrape_ig,
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
  "organization": string,
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
  "source_image_url": string or null
}}

RULES:
- DEFAULT TO INSERT. If the caption is a normal event announcement (even with the same title/location as a candidate), return id=null. Similar candidates alone are NOT a reason to overwrite.
- Same organization_id + strong title/date match: prefer overwrite/link when the caption clearly indicates an update / move / correction / reschedule of that existing event, unless the caption clearly indicates a new instance.
- Different organization_id: never overwrite; always insert (id=null).
- Only set "id" to a candidate id when the caption CLEARLY says the existing event is being updated / moved / changed / corrected / rescheduled (words like update, moved, new room, corrected, rescheduled), OR when cancelling.
- If the caption says the event is cancelled / canceled, return the matched candidate object with "cancelled": true and keep other fields from the candidate unless the caption also corrects them. Cancel requires an id.
- New overlapping fields from the extracted event win, including a shorter description.
- Rebuild "occurrences" correctly on the final object (full list for that event).
- Only use an "id" that appears in the provided candidates for that extracted event.
- Candidates include organization_id, organization, and ig_handle - use them for ownership decisions.
- Omitted candidates are left unchanged. Never delete. Never merge two existing database events into one.
- Return ONLY the JSON array text, no commentary.
""".strip()
