"""Event image extraction and form-payload normalization."""

import logging
from datetime import datetime, timedelta

from schemas.event import normalize_category

log = logging.getLogger(__name__)

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

_LOCATIONS_SET = frozenset(LOCATIONS)
_FOODS_SET = frozenset(FOODS)


def _safe_get(d: dict, key: str, expected_type: type, default):
    """Return ``d[key]`` when it has the expected type."""
    val = d.get(key, default)
    return val if isinstance(val, expected_type) else default


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
    """Validate image extraction data against the event form contract."""
    price_val = parsed.get("price", 0)
    if isinstance(price_val, (int, float)):
        price = max(0.0, float(price_val))
    else:
        price = 0.0

    raw_category = _safe_get(parsed, "category", str, "")
    category = normalize_category(raw_category) or "" if raw_category.strip() else ""

    raw_location = _safe_get(parsed, "location", str, "")
    location = raw_location if raw_location in _LOCATIONS_SET else ""

    food_in = parsed.get("food", [])
    food = [food for food in food_in if isinstance(food, str) and food in _FOODS_SET]

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


def parse_event_image(
    file_contents: bytes,
    content_type: str,
    *,
    user_school: str | None = None,
) -> dict:
    """Extract event form data from an uploaded image file."""
    import base64
    from zoneinfo import ZoneInfo

    from services.school_context import resolve_school_timezone
    from services.scraper.extractor import extract_events_from_post

    base64_data = base64.b64encode(file_contents).decode("utf-8")
    image_url = f"data:{content_type};base64,{base64_data}"
    school = user_school or "uwaterloo"

    extracted_events = extract_events_from_post(
        caption_text=None,
        image_urls=[image_url],
        post_created_at=None,
        school=school,
    )

    if not extracted_events:
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

    event = extracted_events[0]
    local_occurrences = []
    for occurrence in event.get("occurrences", []):
        dtstart_utc_str = occurrence.get("dtstart_utc")
        dtend_utc_str = occurrence.get("dtend_utc")
        tz_str = occurrence.get("tz") or resolve_school_timezone(school)

        try:
            local_tz = ZoneInfo(tz_str)
        except Exception:
            local_tz = ZoneInfo("UTC")

        dtstart_local_str = ""
        dtend_local_str = ""

        if dtstart_utc_str:
            try:
                clean_start = dtstart_utc_str.replace("Z", "+00:00")
                dtstart_utc = datetime.fromisoformat(clean_start)
                dtstart_local_str = dtstart_utc.astimezone(local_tz).strftime("%Y-%m-%dT%H:%M")
            except Exception as exc:
                log.warning("Failed to parse start datetime %s: %s", dtstart_utc_str, exc)

        if dtend_utc_str:
            try:
                clean_end = dtend_utc_str.replace("Z", "+00:00")
                dtend_utc = datetime.fromisoformat(clean_end)
                dtend_local_str = dtend_utc.astimezone(local_tz).strftime("%Y-%m-%dT%H:%M")
            except Exception as exc:
                log.warning("Failed to parse end datetime %s: %s", dtend_utc_str, exc)

        if dtstart_local_str:
            local_occurrences.append(
                {
                    "dtstart_local": dtstart_local_str,
                    "dtend_local": dtend_local_str,
                }
            )

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

    if local_occurrences:
        validated["occurrences"] = local_occurrences

    return validated
