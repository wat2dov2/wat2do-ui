"""AI service — business logic for AI-powered filter and event generation.

Extracts prompt templates, JSON parsing, validation, and normalization
from the router so they can be called from CLI / background jobs without
importing FastAPI.
"""

import json
import logging
import re
import threading
from datetime import datetime, timezone

import openai
from openai import OpenAI

from core.cache import TTLCache
from core.config import settings
from core.constants import EVENT_CATEGORIES
from schemas.event import normalize_category

log = logging.getLogger(__name__)

AI_MAX_TOKENS = 500

# ---------------------------------------------------------------------------
# Daily per-user AI budget cap (M8)
# ---------------------------------------------------------------------------
# Per-user per-day request count stored in a TTL cache with a 25-hour TTL.
# The key is ``(YYYY-MM-DD, user_id)`` so calendar-day rollover resets the
# counter naturally.  A 25 h TTL is enough slack for the date rollover
# check without double-counting: when the UTC date changes, the
# date-prefixed key is simply no longer queried and ages out.
#
# Shares the single-process limitation noted in the rate-limit module
# (see ``core/rate_limit.py`` docstring): for multi-worker deployments,
# swap this in-memory cache for a Redis-backed counter.
DAILY_AI_LIMIT = 100

_daily_ai_cache = TTLCache(default_ttl=25 * 60 * 60)
_daily_ai_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Domain lists shared across prompt templates (DRY — H9/H10)
# ---------------------------------------------------------------------------
LOCATIONS = (
    "SLC",
    "PAC",
    "Library",
    "E7 Building",
    "DC Building",
    "Arts Building",
    "MC Building",
    "PAC Studio",
    "Campus Loop",
)

FOODS = (
    "Pizza",
    "Snacks",
    "Drinks",
    "Sandwiches",
    "Salad",
    "Dessert",
    "Vegan",
    "Gluten-free",
    "BBQ",
    "Candy",
    "Energy Bars",
    "Water",
    "International Cuisine",
    "Catering",
)

# Lookup sets for O(1) membership checks in validate_event_response.
_LOCATIONS_SET = frozenset(LOCATIONS)
_FOODS_SET = frozenset(FOODS)

# Comma-separated canonical category list, built once at import time
# so the prompt always stays in sync with the single source of truth.
_CATEGORIES_CSV = ", ".join(f'"{c}"' for c in EVENT_CATEGORIES)
_LOCATIONS_CSV = ", ".join(f'"{loc}"' for loc in LOCATIONS)
_FOODS_CSV = ", ".join(f'"{f}"' for f in FOODS)

# Regex helpers for cheap format validation.
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^\d{2}:\d{2}$")

# ---------------------------------------------------------------------------
# Prompt templates
# ---------------------------------------------------------------------------

_FILTER_SYSTEM_PROMPT = f"""You are a filter generator for a university events app. Given a natural language description, generate a JSON filter object.

Available options:
- Categories: {_CATEGORIES_CSV}
- Locations: {_LOCATIONS_CSV}
- Foods: {_FOODS_CSV}
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


_EVENT_SYSTEM_PROMPT = f"""You are an event generator for a university events app. Given a natural language description, generate a JSON event object.

Available options:
- Categories: {_CATEGORIES_CSV}
- Locations: {_LOCATIONS_CSV}
- Foods: {_FOODS_CSV}

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


# ---------------------------------------------------------------------------
# Category normalization
# ---------------------------------------------------------------------------


def _normalize_categories(raw_list: list) -> list[str]:
    """Normalize a list of AI-produced categories, dropping unknowns."""
    out: list[str] = []
    for item in raw_list:
        if not isinstance(item, str):
            continue
        canonical = normalize_category(item)
        if canonical is not None and canonical not in out:
            out.append(canonical)
    return out


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------


from core.exceptions import AIServiceError  # noqa: E402 — re-exported for callers


def _safe_get(d: dict, key: str, expected_type: type, default):
    """Return ``d[key]`` if it exists and is an instance of *expected_type*, else *default*."""
    val = d.get(key, default)
    return val if isinstance(val, expected_type) else default


def parse_json_response(content: str) -> dict:
    """Parse JSON from OpenAI response, stripping markdown fences if present.

    Raises ``AIServiceError`` if the content is not valid JSON.
    """
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
    except json.JSONDecodeError as e:
        log.warning("AI returned invalid JSON: %s", e)
        raise AIServiceError("AI returned invalid JSON. Please try again.", error_kind="parse")


# ---------------------------------------------------------------------------
# OpenAI client
# ---------------------------------------------------------------------------


def get_openai_client() -> OpenAI:
    """Return a configured OpenAI client.

    Raises ``AIServiceError`` if the API key is not configured.
    """
    if not settings.openai_api_key:
        raise AIServiceError(
            "OpenAI API key not configured on the server.",
            is_config_error=True,
        )
    return OpenAI(api_key=settings.openai_api_key, timeout=settings.openai_timeout)


def _call_chat_completion(
    client: OpenAI,
    *,
    system_prompt: str,
    user_prompt: str,
    temperature: float,
):
    """Invoke the OpenAI chat completion endpoint with JSON-mode enforced.

    Wraps the SDK call so we can:
    * force ``response_format={"type": "json_object"}`` (M6) — the model
      is contractually obliged to return valid JSON when this flag is
      set, so parse failures become truly exceptional instead of a
      routine waste of tokens;
    * map upstream ``openai.*`` errors to ``AIServiceError`` (M14) so
      the global 502 handler kicks in with a user-friendly message
      instead of a raw 500 with a traceback containing request-IDs and
      org-IDs.
    """
    try:
        return client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=temperature,
            max_tokens=AI_MAX_TOKENS,
            response_format={"type": "json_object"},
        )
    except openai.RateLimitError as e:
        log.warning("OpenAI rate limit: %s", e)
        raise AIServiceError("AI service is busy, please try again shortly.", error_kind="api")
    except openai.APITimeoutError as e:
        log.warning("OpenAI timeout: %s", e)
        raise AIServiceError("AI service timed out, please try again.", error_kind="api")
    except openai.APIConnectionError as e:
        log.warning("OpenAI connection error: %s", e)
        raise AIServiceError("AI service is unreachable, please try again.", error_kind="api")
    except openai.APIError as e:
        log.warning("OpenAI API error: %s", e)
        raise AIServiceError("AI service returned an error.", error_kind="api")
    except openai.OpenAIError as e:
        log.warning("OpenAI SDK error: %s", e)
        raise AIServiceError("AI service error.", error_kind="api")


# ---------------------------------------------------------------------------
# Daily budget gating (M8)
# ---------------------------------------------------------------------------


def _today_key() -> str:
    """UTC calendar day key used to scope the per-user daily counter."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def enforce_daily_ai_budget(user_id: str, limit: int = DAILY_AI_LIMIT) -> None:
    """Raise ``AIServiceError`` if *user_id* has exceeded the daily AI budget.

    The per-minute ``ai_rate_limiter`` stops short bursts; this function
    adds a daily ceiling so a determined account can't sustain abuse for
    hours at a time (audit M8).  Counter is in-memory and lives in a
    25-hour TTL cache, so it auto-cleans on the next day's first request.

    Note: like the sliding-window rate limiter in ``core/rate_limit.py``,
    this counter is process-local.  Multi-worker deployments would need a
    Redis-backed shared counter (single-process limitation flagged in
    P1).
    """
    if not user_id:
        return
    key = f"ai:{_today_key()}:{user_id}"
    with _daily_ai_lock:
        current = _daily_ai_cache.get(key) or 0
        if current >= limit:
            log.warning(
                "User %s exceeded daily AI budget (%d/%d)",
                user_id,
                current,
                limit,
            )
            raise AIServiceError(
                f"Daily AI request limit ({limit}) reached. Please try again tomorrow.",
                error_kind="api",
            )
        _daily_ai_cache.set(key, current + 1)


# ---------------------------------------------------------------------------
# Filter generation
# ---------------------------------------------------------------------------


def validate_filter_response(parsed: dict) -> dict:
    """Validate and sanitize the parsed filter JSON into a dict matching FilterStateResponse."""
    price_raw = parsed.get("priceRange")
    if isinstance(price_raw, dict):
        price_range = {
            "min": str(price_raw.get("min", "")) if price_raw.get("min") is not None else "",
            "max": str(price_raw.get("max", "")) if price_raw.get("max") is not None else "",
        }
    else:
        price_range = {"min": "", "max": ""}

    return {
        "searchQuery": _safe_get(parsed, "searchQuery", str, ""),
        "categories": _normalize_categories(parsed.get("categories", [])),
        "locations": [loc for loc in parsed.get("locations", []) if isinstance(loc, str)],
        "foods": [f for f in parsed.get("foods", []) if isinstance(f, str)],
        "days": [d for d in parsed.get("days", []) if isinstance(d, str)],
        "priceRange": price_range,
        "dateRange": _safe_get(parsed, "dateRange", str, ""),
        "addedSince": _safe_get(parsed, "addedSince", str, ""),
        "requiresRegistration": _safe_get(parsed, "requiresRegistration", bool, False),
    }


def generate_filters(
    prompt: str,
    *,
    client: OpenAI | None = None,
    user_id: str | None = None,
) -> dict:
    """Generate filter state from a natural language prompt.

    Returns a dict matching the FilterStateResponse schema.
    Raises ``AIServiceError`` on configuration or parsing errors.
    *client* can be injected; defaults to ``get_openai_client()``.

    *user_id* scopes the per-user daily budget counter (M8).  It's
    optional so internal callers (CLI, jobs) can bypass the cap, but the
    router always passes it.
    """
    if user_id is not None:
        enforce_daily_ai_budget(user_id)

    if client is None:
        client = get_openai_client()

    prompt_with_date = _FILTER_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).isoformat(),
    )

    response = _call_chat_completion(
        client,
        system_prompt=prompt_with_date,
        user_prompt=prompt,
        temperature=settings.openai_temperature_precise,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise AIServiceError("Empty response from AI. Please try a different prompt.")

    parsed = parse_json_response(content)
    return validate_filter_response(parsed)


# ---------------------------------------------------------------------------
# Event generation
# ---------------------------------------------------------------------------


def _validate_date(raw: str, fallback: str) -> str:
    """Return *raw* iff it's a valid YYYY-MM-DD string, else *fallback*.

    Uses ``datetime.strptime`` rather than the regex alone so values like
    ``"2024-99-99"`` (matching the shape but invalid) are rejected (M7).
    """
    if not raw or not _DATE_RE.match(raw):
        return fallback
    try:
        datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return fallback
    return raw


def _validate_time(raw: str, fallback: str) -> str:
    """Return *raw* iff it's a valid HH:MM 24-hour string, else *fallback* (M7)."""
    if not raw or not _TIME_RE.match(raw):
        return fallback
    try:
        datetime.strptime(raw, "%H:%M")
    except ValueError:
        return fallback
    return raw


def validate_event_response(parsed: dict) -> dict:
    """Validate and sanitize the parsed event JSON into a dict matching EventFormDataResponse.

    Applies the same invariants the public event-create endpoint enforces
    (M7):
      * ``price`` clamped to >= 0 so a negative literal from the model
        can't propagate into the form prefill;
      * ``date`` validated against ``YYYY-MM-DD`` via ``strptime``;
      * ``time`` validated against ``HH:MM`` via ``strptime``;
      * ``location`` reduced to the canonical ``LOCATIONS`` set — unknown
        values are dropped, mirroring the behaviour for categories;
      * ``food`` filtered against ``FOODS``.
    """
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    price_val = parsed.get("price", 0)
    if isinstance(price_val, (int, float)):
        price = max(0.0, float(price_val))
    else:
        price = 0.0

    # Normalize category: map legacy names, drop unrecognized ones
    raw_category = _safe_get(parsed, "category", str, "")
    if raw_category.strip():
        category = normalize_category(raw_category) or ""
    else:
        category = ""

    raw_location = _safe_get(parsed, "location", str, "")
    location = raw_location if raw_location in _LOCATIONS_SET else ""

    raw_date = _safe_get(parsed, "date", str, today)
    raw_time = _safe_get(parsed, "time", str, "12:00")

    food_in = parsed.get("food", [])
    food = [f for f in food_in if isinstance(f, str) and f in _FOODS_SET]

    return {
        "title": _safe_get(parsed, "title", str, ""),
        "description": _safe_get(parsed, "description", str, ""),
        "date": _validate_date(raw_date, today),
        "time": _validate_time(raw_time, "12:00"),
        "location": location,
        "category": category,
        "price": price,
        "food": food,
        "requiresRegistration": _safe_get(parsed, "requiresRegistration", bool, False),
        "organization": _safe_get(parsed, "organization", str, ""),
    }


def generate_event(
    prompt: str,
    *,
    client: OpenAI | None = None,
    user_id: str | None = None,
) -> dict:
    """Generate event form data from a natural language prompt.

    Returns a dict matching the EventFormDataResponse schema.
    Raises ``AIServiceError`` on configuration or parsing errors.
    *client* can be injected; defaults to ``get_openai_client()``.

    *user_id* scopes the per-user daily budget counter (M8).
    """
    if user_id is not None:
        enforce_daily_ai_budget(user_id)

    if client is None:
        client = get_openai_client()

    prompt_with_date = _EVENT_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )

    response = _call_chat_completion(
        client,
        system_prompt=prompt_with_date,
        user_prompt=prompt,
        temperature=settings.openai_temperature_creative,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise AIServiceError("Empty response from AI. Please try a different prompt.")

    parsed = parse_json_response(content)
    return validate_event_response(parsed)
