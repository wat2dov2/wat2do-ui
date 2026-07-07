"""AI service — business logic for AI-powered filter and event generation.

Extracts prompt templates, JSON parsing, validation, and normalization
from the router so they can be called from CLI / background jobs without
importing FastAPI.
"""

import json
import logging
import threading
from datetime import datetime, timedelta, timezone

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
  "registration": false
}}}}

IMPORTANT RULES:
- categories: You MUST only use categories from the list above. Do NOT invent new category names.
- days: Use day of week names. "weekend" = ["Saturday", "Sunday"]. "weekday" = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]. "friday" = ["Friday"], etc.
- dateRange: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-25T00:00:00.000Z". Leave empty "" if not specified.
- addedSince: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-07T00:00:00.000Z". Leave empty "" if not specified.
- priceRange: Free events = {{{{"min": "0", "max": "0"}}}}. Under $10 = {{{{"min": "", "max": "10"}}}}.
- registration: Set true only if user explicitly wants events requiring registration.
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
  "occurrences": [
    {{{{"dtstart_local": "", "dtend_local": ""}}}}
  ],
  "location": "",
  "category": "",
  "price": 0,
  "food": [],
  "registration": false
}}}}

IMPORTANT RULES:
- title: Create a catchy, descriptive event title
- description: Write 1-2 sentences describing the event
- occurrences: Array of event date/time objects. Use "YYYY-MM-DDTHH:MM" local datetime strings for dtstart_local and dtend_local. Leave dtend_local "" if no end time is specified.
- location: Use one of the available locations above
- category: You MUST use one of the available categories above. Do NOT invent new category names.
- price: Number (0 for free events)
- food: Array of food items from the available options, empty array [] if none
- registration: true/false
- Return raw JSON only, no markdown code blocks.

Today's date is {{today}}.

Examples:
- "tech talk about AI next friday at 2pm" -> title: "Tech Talk: The Future of AI", occurrences: [{{{{"dtstart_local": "YYYY-MM-DDT14:00", "dtend_local": ""}}}}], category: "Technology"
- "free pizza social at SLC" -> title: "Pizza Social Mixer", location: "SLC", price: 0, food: ["Pizza"], category: "Games"
- "hackathon this weekend with registration" -> title: "Weekend Hackathon", registration: true, category: "Technology\""""


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
            error_kind="config",
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
        "registration": _safe_get(parsed, "registration", bool, False),
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


def _default_local_datetime() -> str:
    next_hour = datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
    return next_hour.strftime("%Y-%m-%dT%H:%M")


def _validate_local_datetime(raw: str, fallback: str) -> str:
    if not raw:
        return fallback
    try:
        datetime.strptime(raw, "%Y-%m-%dT%H:%M")
    except ValueError:
        return fallback
    return raw


def _validate_occurrences(raw: object) -> list[dict[str, str]]:
    fallback = [{"dtstart_local": _default_local_datetime(), "dtend_local": ""}]
    if not isinstance(raw, list):
        return fallback

    occurrences: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        dtstart = _validate_local_datetime(
            _safe_get(item, "dtstart_local", str, ""),
            "",
        )
        if not dtstart:
            continue
        dtend_raw = _safe_get(item, "dtend_local", str, "")
        occurrences.append(
            {
                "dtstart_local": dtstart,
                "dtend_local": _validate_local_datetime(dtend_raw, "") if dtend_raw else "",
            }
        )
    return occurrences or fallback


def validate_event_response(parsed: dict) -> dict:
    """Validate and sanitize the parsed event JSON into a dict matching EventFormDataResponse.

    Applies the same invariants the public event-create endpoint enforces
    (M7):
      * ``price`` clamped to >= 0 so a negative literal from the model
        can't propagate into the form prefill;
      * ``occurrences`` validated against ``YYYY-MM-DDTHH:MM`` via ``strptime``;
      * ``location`` reduced to the canonical ``LOCATIONS`` set — unknown
        values are dropped, mirroring the behaviour for categories;
      * ``food`` filtered against ``FOODS``.
    """
    price_val = parsed.get("price", 0)
    if isinstance(price_val, (int, float)):
        price = max(0.0, float(price_val))
    else:
        price = 0.0

    # Normalize category and drop unrecognized values.
    raw_category = _safe_get(parsed, "category", str, "")
    if raw_category.strip():
        category = normalize_category(raw_category) or ""
    else:
        category = ""

    raw_location = _safe_get(parsed, "location", str, "")
    location = raw_location if raw_location in _LOCATIONS_SET else ""

    food_in = parsed.get("food", [])
    food = [f for f in food_in if isinstance(f, str) and f in _FOODS_SET]

    return {
        "title": _safe_get(parsed, "title", str, ""),
        "description": _safe_get(parsed, "description", str, ""),
        "occurrences": _validate_occurrences(parsed.get("occurrences")),
        "location": location,
        "category": category,
        "price": price,
        "food": food,
        "registration": _safe_get(parsed, "registration", bool, False),
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


def parse_event_image(
    file_contents: bytes,
    content_type: str,
    *,
    client: OpenAI | None = None,
    user_id: str | None = None,
    user_school: str | None = None,
) -> dict:
    """Extract event form data from an uploaded image file using OpenAI Vision."""
    import base64
    from zoneinfo import ZoneInfo

    from services.school_context import resolve_school_timezone
    from services.scraper.extractor import extract_events_from_post

    if user_id is not None:
        enforce_daily_ai_budget(user_id)

    # Encode the image bytes to base64
    base64_data = base64.b64encode(file_contents).decode("utf-8")
    image_url = f"data:{content_type};base64,{base64_data}"

    school = user_school or "uwaterloo"

    # Call the existing extractor service
    # extract_events_from_post accepts caption_text, image_urls, post_created_at, school
    extracted_events = extract_events_from_post(
        caption_text=None,
        image_urls=[image_url],
        post_created_at=None,
        school=school,
    )

    if not extracted_events:
        # Return default empty event form response
        return {
            "title": "",
            "description": "",
            "occurrences": [],
            "location": "",
            "category": "",
            "price": 0.0,
            "food": [],
            "registration": False,
        }

    # Grab the first extracted event
    event = extracted_events[0]

    # Convert UTC occurrences to local occurrences for the frontend form prefill
    local_occurrences = []
    for occ in event.get("occurrences", []):
        dtstart_utc_str = occ.get("dtstart_utc")
        dtend_utc_str = occ.get("dtend_utc")
        tz_str = occ.get("tz") or resolve_school_timezone(school)

        try:
            local_tz = ZoneInfo(tz_str)
        except Exception:
            local_tz = ZoneInfo("UTC")

        dtstart_local_str = ""
        dtend_local_str = ""

        if dtstart_utc_str:
            try:
                # Remove Z and parse
                clean_start = dtstart_utc_str.replace("Z", "+00:00")
                dtstart_utc = datetime.fromisoformat(clean_start)
                dtstart_local = dtstart_utc.astimezone(local_tz)
                dtstart_local_str = dtstart_local.strftime("%Y-%m-%dT%H:%M")
            except Exception as e:
                log.warning("Failed to parse start datetime %s: %s", dtstart_utc_str, e)

        if dtend_utc_str:
            try:
                clean_end = dtend_utc_str.replace("Z", "+00:00")
                dtend_utc = datetime.fromisoformat(clean_end)
                dtend_local = dtend_utc.astimezone(local_tz)
                dtend_local_str = dtend_local.strftime("%Y-%m-%dT%H:%M")
            except Exception as e:
                log.warning("Failed to parse end datetime %s: %s", dtend_utc_str, e)

        if dtstart_local_str:
            local_occurrences.append(
                {
                    "dtstart_local": dtstart_local_str,
                    "dtend_local": dtend_local_str,
                }
            )

    # Validate and sanitize other fields
    validated = validate_event_response(
        {
            "title": event.get("title", ""),
            "description": event.get("description", ""),
            "location": event.get("location", ""),
            "category": event.get("category", ""),
            "price": event.get("price", 0.0),
            "food": event.get("food", []),
            "registration": event.get("registration", False),
        }
    )

    # Overwrite validated occurrences with converted local occurrences
    if local_occurrences:
        validated["occurrences"] = local_occurrences

    return validated
