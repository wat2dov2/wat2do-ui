import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAI

from constants import EVENT_CATEGORIES, CATEGORY_NORMALIZE_MAP
from core.auth import get_current_user
from core.config import settings
from core.errors import AI_EMPTY_RESPONSE, AI_INVALID_JSON, AI_NOT_CONFIGURED
from core.rate_limit import ai_rate_limiter
from schemas.ai import AIPromptRequest, FilterStateResponse, EventFormDataResponse

log = logging.getLogger(__name__)

# Comma-separated canonical category list, built once at import time
# so the prompt always stays in sync with the single source of truth.
_CATEGORIES_CSV = ", ".join(f'"{c}"' for c in EVENT_CATEGORIES)

router = APIRouter(prefix="/ai", tags=["ai"])

# ---------------------------------------------------------------------------
# OpenAI configuration constants
# ---------------------------------------------------------------------------
OPENAI_MODEL = "gpt-4o-mini"
AI_MAX_TOKENS = 500
AI_TEMPERATURE_PRECISE = 0.3   # structured / deterministic output (filters)
AI_TEMPERATURE_CREATIVE = 0.7  # creative / varied output (event generation)


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=AI_NOT_CONFIGURED,
        )
    return OpenAI(api_key=settings.openai_api_key)


def _parse_json_response(content: str) -> dict:
    """Parse JSON from OpenAI response, stripping markdown fences if present."""
    text = content.strip()
    if text.startswith("```json"):
        text = text[7:]
    elif text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=AI_INVALID_JSON,
        )


# ---------------------------------------------------------------------------
# Filter generation
# ---------------------------------------------------------------------------

_FILTER_SYSTEM_PROMPT = f"""You are a filter generator for a university events app. Given a natural language description, generate a JSON filter object.

Available options:
- Categories: {_CATEGORIES_CSV}
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"
- Days (day of week): "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{{{{
  "searchQuery": "",
  "categories": [],
  "locations": [],
  "foods": [],
  "days": [],
  "priceRange": {{{{ "min": "", "max": "" }}}},
  "dateRange": "",
  "addedSince": "",
  "requiresRegistration": false
}}}}

IMPORTANT RULES:
- categories: You MUST only use categories from the list above. Do NOT invent new category names.
- days: Use day of week names. "weekend" = ["Saturday", "Sunday"]. "weekday" = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]. "friday" = ["Friday"], etc.
- dateRange: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-25T00:00:00.000Z". Leave empty "" if not specified.
- addedSince: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-07T00:00:00.000Z". Leave empty "" if not specified.
- priceRange: Free events = {{{{"min": "0", "max": "0"}}}}. Under $10 = {{{{"min": "", "max": "10"}}}}.
- requiresRegistration: Set true only if user explicitly wants events requiring registration.
- Only use values from the available options above.
- Return raw JSON only, no markdown code blocks.

Today's date is {{today}}.

Examples:
- "free tech events on weekends with pizza" -> categories: ["Technology"], days: ["Saturday", "Sunday"], foods: ["Pizza"], priceRange: {{{{"min": "0", "max": "0"}}}}
- "friday social events at SLC" -> categories: ["Games", "Partying"], days: ["Friday"], locations: ["SLC"]
- "events on December 25th" -> dateRange: "2024-12-25T00:00:00.000Z"
- "events added in the last 3 days" -> addedSince: calculate 3 days before today in ISO format"""


_CANONICAL_SET = frozenset(EVENT_CATEGORIES)


def _normalize_category(raw: str) -> str | None:
    """Map a raw AI-produced category to the canonical value.

    Returns the canonical category string, or ``None`` if the value
    cannot be mapped (in which case it should be dropped).
    """
    raw = raw.strip()
    if raw in _CANONICAL_SET:
        return raw
    mapped = CATEGORY_NORMALIZE_MAP.get(raw)
    if mapped is not None:
        log.warning("AI returned legacy category %r, normalized to %r", raw, mapped)
        return mapped
    log.warning("AI returned unrecognized category %r, dropping it", raw)
    return None


def _normalize_categories(raw_list: list) -> list[str]:
    """Normalize a list of AI-produced categories, dropping unknowns."""
    out: list[str] = []
    for item in raw_list:
        if not isinstance(item, str):
            continue
        canonical = _normalize_category(item)
        if canonical is not None and canonical not in out:
            out.append(canonical)
    return out


def _validate_filter_response(parsed: dict) -> FilterStateResponse:
    """Validate and sanitize the parsed filter JSON into a FilterStateResponse."""
    price_raw = parsed.get("priceRange")
    if isinstance(price_raw, dict):
        price_range = {
            "min": str(price_raw.get("min", "")) if price_raw.get("min") is not None else "",
            "max": str(price_raw.get("max", "")) if price_raw.get("max") is not None else "",
        }
    else:
        price_range = {"min": "", "max": ""}

    return FilterStateResponse(
        searchQuery=parsed.get("searchQuery", "") if isinstance(parsed.get("searchQuery"), str) else "",
        categories=_normalize_categories(parsed.get("categories", [])),
        locations=[loc for loc in parsed.get("locations", []) if isinstance(loc, str)],
        foods=[f for f in parsed.get("foods", []) if isinstance(f, str)],
        days=[d for d in parsed.get("days", []) if isinstance(d, str)],
        priceRange=price_range,
        dateRange=parsed.get("dateRange", "") if isinstance(parsed.get("dateRange"), str) else "",
        addedSince=parsed.get("addedSince", "") if isinstance(parsed.get("addedSince"), str) else "",
        requiresRegistration=parsed.get("requiresRegistration", False) if isinstance(parsed.get("requiresRegistration"), bool) else False,
    )


@router.post("/generate-filters", response_model=FilterStateResponse)
def generate_filters(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_rate_limiter.dependency()),
):
    client = _get_openai_client()

    prompt_with_date = _FILTER_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).isoformat(),
    )

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": prompt_with_date},
            {"role": "user", "content": body.prompt},
        ],
        temperature=AI_TEMPERATURE_PRECISE,
        max_tokens=AI_MAX_TOKENS,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=AI_EMPTY_RESPONSE,
        )

    parsed = _parse_json_response(content)
    return _validate_filter_response(parsed)


# ---------------------------------------------------------------------------
# Event generation
# ---------------------------------------------------------------------------

_EVENT_SYSTEM_PROMPT = f"""You are an event generator for a university events app. Given a natural language description, generate a JSON event object.

Available options:
- Categories: {_CATEGORIES_CSV}
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{{{{
  "title": "",
  "description": "",
  "date": "",
  "time": "",
  "location": "",
  "category": "",
  "price": 0,
  "food": [],
  "requiresRegistration": false,
  "organization": ""
}}}}

IMPORTANT RULES:
- title: Create a catchy, descriptive event title
- description: Write 1-2 sentences describing the event
- date: Use format "YYYY-MM-DD". If no date specified, use a reasonable upcoming date.
- time: Use 24-hour format "HH:MM" (e.g., "14:00" for 2 PM, "18:30" for 6:30 PM)
- location: Use one of the available locations above
- category: You MUST use one of the available categories above. Do NOT invent new category names.
- price: Number (0 for free events)
- food: Array of food items from the available options, empty array [] if none
- requiresRegistration: true/false
- organization: Create a reasonable club/organization name if not specified
- Return raw JSON only, no markdown code blocks.

Today's date is {{today}}.

Examples:
- "tech talk about AI next friday at 2pm" -> title: "Tech Talk: The Future of AI", date: next friday's date, time: "14:00", category: "Technology"
- "free pizza social at SLC" -> title: "Pizza Social Mixer", location: "SLC", price: 0, food: ["Pizza"], category: "Games"
- "hackathon this weekend with registration" -> title: "Weekend Hackathon", requiresRegistration: true, category: "Technology\""""


def _validate_event_response(parsed: dict) -> EventFormDataResponse:
    """Validate and sanitize the parsed event JSON into an EventFormDataResponse."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    price_val = parsed.get("price", 0)
    if isinstance(price_val, (int, float)):
        price = float(price_val)
    else:
        price = 0.0

    # Normalize category: map legacy names, drop unrecognized ones
    raw_category = parsed.get("category", "")
    if isinstance(raw_category, str) and raw_category.strip():
        category = _normalize_category(raw_category) or ""
    else:
        category = ""

    return EventFormDataResponse(
        title=parsed.get("title", "") if isinstance(parsed.get("title"), str) else "",
        description=parsed.get("description", "") if isinstance(parsed.get("description"), str) else "",
        date=parsed.get("date", today) if isinstance(parsed.get("date"), str) else today,
        time=parsed.get("time", "12:00") if isinstance(parsed.get("time"), str) else "12:00",
        location=parsed.get("location", "") if isinstance(parsed.get("location"), str) else "",
        category=category,
        price=price,
        food=[f for f in parsed.get("food", []) if isinstance(f, str)],
        requiresRegistration=parsed.get("requiresRegistration", False) if isinstance(parsed.get("requiresRegistration"), bool) else False,
        organization=parsed.get("organization", "") if isinstance(parsed.get("organization"), str) else "",
    )


@router.post("/generate-event", response_model=EventFormDataResponse)
def generate_event(
    body: AIPromptRequest,
    _user: dict = Depends(get_current_user),
    _rl: None = Depends(ai_rate_limiter.dependency()),
):
    client = _get_openai_client()

    prompt_with_date = _EVENT_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )

    response = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=[
            {"role": "system", "content": prompt_with_date},
            {"role": "user", "content": body.prompt},
        ],
        temperature=AI_TEMPERATURE_CREATIVE,
        max_tokens=AI_MAX_TOKENS,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=AI_EMPTY_RESPONSE,
        )

    parsed = _parse_json_response(content)
    return _validate_event_response(parsed)
