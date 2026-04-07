import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status
from openai import OpenAI

from core.config import settings
from schemas.ai import AIPromptRequest, FilterStateResponse, EventFormDataResponse

router = APIRouter(prefix="/ai", tags=["ai"])


def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="OpenAI API key not configured on the server.",
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
            detail="AI returned invalid JSON. Please try again.",
        )


# ---------------------------------------------------------------------------
# Filter generation
# ---------------------------------------------------------------------------

_FILTER_SYSTEM_PROMPT = """You are a filter generator for a university events app. Given a natural language description, generate a JSON filter object.

Available options:
- Categories: "Academic", "Social & Games", "Cultural", "Religious", "Sports & Fitness", "Technology", "Arts & Crafts", "Music & Performance", "Health & Wellness", "Entrepreneurship"
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"
- Days (day of week): "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{
  "searchQuery": "",
  "categories": [],
  "locations": [],
  "foods": [],
  "days": [],
  "priceRange": { "min": "", "max": "" },
  "dateRange": "",
  "addedSince": "",
  "requiresRegistration": false
}

IMPORTANT RULES:
- days: Use day of week names. "weekend" = ["Saturday", "Sunday"]. "weekday" = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]. "friday" = ["Friday"], etc.
- dateRange: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-25T00:00:00.000Z". Leave empty "" if not specified.
- addedSince: Use full ISO 8601 format "YYYY-MM-DDTHH:mm:ss.sssZ". Example: "2024-12-07T00:00:00.000Z". Leave empty "" if not specified.
- priceRange: Free events = {"min": "0", "max": "0"}. Under $10 = {"min": "", "max": "10"}.
- requiresRegistration: Set true only if user explicitly wants events requiring registration.
- Only use values from the available options above.
- Return raw JSON only, no markdown code blocks.

Today's date is {today}.

Examples:
- "free tech events on weekends with pizza" -> categories: ["Technology"], days: ["Saturday", "Sunday"], foods: ["Pizza"], priceRange: {{"min": "0", "max": "0"}}
- "friday social events at SLC" -> categories: ["Social & Games"], days: ["Friday"], locations: ["SLC"]
- "events on December 25th" -> dateRange: "2024-12-25T00:00:00.000Z"
- "events added in the last 3 days" -> addedSince: calculate 3 days before today in ISO format"""


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
        categories=[c for c in parsed.get("categories", []) if isinstance(c, str)],
        locations=[loc for loc in parsed.get("locations", []) if isinstance(loc, str)],
        foods=[f for f in parsed.get("foods", []) if isinstance(f, str)],
        days=[d for d in parsed.get("days", []) if isinstance(d, str)],
        priceRange=price_range,
        dateRange=parsed.get("dateRange", "") if isinstance(parsed.get("dateRange"), str) else "",
        addedSince=parsed.get("addedSince", "") if isinstance(parsed.get("addedSince"), str) else "",
        requiresRegistration=parsed.get("requiresRegistration", False) if isinstance(parsed.get("requiresRegistration"), bool) else False,
    )


@router.post("/generate-filters", response_model=FilterStateResponse)
def generate_filters(body: AIPromptRequest):
    client = _get_openai_client()

    prompt_with_date = _FILTER_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).isoformat(),
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": prompt_with_date},
            {"role": "user", "content": body.prompt},
        ],
        temperature=0.3,
        max_tokens=500,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Empty response from AI. Please try a different prompt.",
        )

    parsed = _parse_json_response(content)
    return _validate_filter_response(parsed)


# ---------------------------------------------------------------------------
# Event generation
# ---------------------------------------------------------------------------

_EVENT_SYSTEM_PROMPT = """You are an event generator for a university events app. Given a natural language description, generate a JSON event object.

Available options:
- Categories: "Academic", "Social & Games", "Cultural", "Religious", "Sports & Fitness", "Technology", "Arts & Crafts", "Music & Performance", "Health & Wellness", "Entrepreneurship", "Events", "Clubs", "Career"
- Locations: "SLC", "PAC", "Library", "E7 Building", "DC Building", "Arts Building", "MC Building", "PAC Studio", "Campus Loop"
- Foods: "Pizza", "Snacks", "Drinks", "Sandwiches", "Salad", "Dessert", "Vegan", "Gluten-free", "BBQ", "Candy", "Energy Bars", "Water", "International Cuisine", "Catering"

Return ONLY valid JSON matching this structure (no markdown, no explanation):
{{
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
}}

IMPORTANT RULES:
- title: Create a catchy, descriptive event title
- description: Write 1-2 sentences describing the event
- date: Use format "YYYY-MM-DD". If no date specified, use a reasonable upcoming date.
- time: Use 24-hour format "HH:MM" (e.g., "14:00" for 2 PM, "18:30" for 6:30 PM)
- location: Use one of the available locations above
- category: Use one of the available categories above
- price: Number (0 for free events)
- food: Array of food items from the available options, empty array [] if none
- requiresRegistration: true/false
- organization: Create a reasonable club/organization name if not specified
- Return raw JSON only, no markdown code blocks.

Today's date is {today}.

Examples:
- "tech talk about AI next friday at 2pm" -> title: "Tech Talk: The Future of AI", date: next friday's date, time: "14:00", category: "Technology"
- "free pizza social at SLC" -> title: "Pizza Social Mixer", location: "SLC", price: 0, food: ["Pizza"], category: "Social & Games"
- "hackathon this weekend with registration" -> title: "Weekend Hackathon", requiresRegistration: true, category: "Technology\""""


def _validate_event_response(parsed: dict) -> EventFormDataResponse:
    """Validate and sanitize the parsed event JSON into an EventFormDataResponse."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    price_val = parsed.get("price", 0)
    if isinstance(price_val, (int, float)):
        price = float(price_val)
    else:
        price = 0.0

    return EventFormDataResponse(
        title=parsed.get("title", "") if isinstance(parsed.get("title"), str) else "",
        description=parsed.get("description", "") if isinstance(parsed.get("description"), str) else "",
        date=parsed.get("date", today) if isinstance(parsed.get("date"), str) else today,
        time=parsed.get("time", "12:00") if isinstance(parsed.get("time"), str) else "12:00",
        location=parsed.get("location", "") if isinstance(parsed.get("location"), str) else "",
        category=parsed.get("category", "") if isinstance(parsed.get("category"), str) else "",
        price=price,
        food=[f for f in parsed.get("food", []) if isinstance(f, str)],
        requiresRegistration=parsed.get("requiresRegistration", False) if isinstance(parsed.get("requiresRegistration"), bool) else False,
        organization=parsed.get("organization", "") if isinstance(parsed.get("organization"), str) else "",
    )


@router.post("/generate-event", response_model=EventFormDataResponse)
def generate_event(body: AIPromptRequest):
    client = _get_openai_client()

    prompt_with_date = _EVENT_SYSTEM_PROMPT.format(
        today=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": prompt_with_date},
            {"role": "user", "content": body.prompt},
        ],
        temperature=0.7,
        max_tokens=500,
    )

    content = response.choices[0].message.content or ""
    if not content.strip():
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Empty response from AI. Please try a different prompt.",
        )

    parsed = _parse_json_response(content)
    return _validate_event_response(parsed)
