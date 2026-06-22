from datetime import datetime, timedelta, timezone

from core.config import settings
from core.constants import BUCKET_EVENT_IMAGES
from core.database import get_sb
from core.tables import EVENT_DATES, EVENTS


def _public_url(bucket: str, path: str) -> str | None:
    base = settings.supabase_url
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def _seed_image(i: int) -> str | None:
    return _public_url(BUCKET_EVENT_IMAGES, f"seed/event-{i:03d}.jpg")


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


now = datetime.now(timezone.utc)
BASE = now + timedelta(days=10)
ORGS = [
    "UW Board Games Organization",
    "UW Computer Science Organization",
    "Pre-Pharmacy, UW",
    "UW Music Society",
    "UW Intramurals",
]
# Use canonical categories (same taxonomy as backend/frontend filters).
CATEGORIES = [
    "Arts & Culture",
    "Business",
    "Community Service",
    "Environment",
    "Games & Recreation",
    "Health",
    "Media & Web",
    "Politics & Advocacy",
    "Religion & Spirituality",
]

VENUES = [
    "Student Life Centre",
    "Dana Porter Library",
    "Engineering 5",
    "Mathematics 3",
    "Federation Hall",
    "Physical Activities Complex",
    "Environment 3",
    "Hagey Hall",
    "QNC Atrium",
    "Village 1 Great Hall",
]

EVENT_TITLES = [
    "Board Game Night",
    "Tech Career Fair",
    "UWMUN Events",
    "Campus Open Mic",
    "Startup Pitch Practice",
    "Volunteer Fair",
    "Bike Repair Pop-Up",
    "Chess Ladder Night",
    "Mental Health Snack Chat",
    "Indie Film Screening",
    "Resume Roast Workshop",
    "Hack Night: Tiny Tools",
    "Beginner Salsa Social",
    "Plant Swap",
    "Coffee With Professors",
    "Retro Games Tournament",
    "Public Speaking Lab",
    "Community Kitchen Shift",
    "Photography Walk",
    "Robotics Demo Day",
    "Trivia Night",
    "Study Jam",
    "Financial Literacy 101",
    "Campus Clean-Up",
    "Yoga Reset",
    "Creative Writing Circle",
    "AI Reading Group",
    "Pharmacy Mixer",
    "Intramural Dodgeball",
    "Design Portfolio Review",
    "Climate Action Roundtable",
    "Karaoke Night",
    "Intro to Web Scraping",
    "Board Games and Bubble Tea",
    "Women in STEM Panel",
    "Potluck Social",
    "Music Theory Crash Course",
    "Case Competition Prep",
    "Data Visualization Workshop",
    "Sustainability Clothing Swap",
    "Badminton Drop-In",
    "Campus Faith Dialogue",
    "Entrepreneurship Coffee Chats",
    "Dungeons and Dragons One-Shot",
    "Public Policy Debate",
    "Zine-Making Workshop",
    "Health Sciences Networking",
    "Open Source Sprint",
    "Late-Night Pancake Study Break",
    "End-of-Week Social",
]

FOOD_OPTIONS = [
    None,
    ["Pizza"],
    ["Bubble tea"],
    ["Coffee", "Cookies"],
    ["Fruit", "Granola bars"],
    ["Pancakes"],
]


def _seed_event(i: int, title: str) -> dict:
    start = BASE + timedelta(days=i, hours=9 + (i % 8), minutes=30 if i % 3 == 0 else 0)
    end = start + timedelta(hours=1 + (i % 3))
    category = CATEGORIES[i % len(CATEGORIES)]
    organization = ORGS[i % len(ORGS)]

    return {
        "title": title,
        "description": (
            f"A seeded upcoming campus event for testing the event feed with many cards. "
            f"This one is focused on {category.lower()}."
        ),
        "location": VENUES[i % len(VENUES)],
        "price": 0 if i % 4 else 5,
        "food": FOOD_OPTIONS[i % len(FOOD_OPTIONS)],
        "registration": i % 5 == 0,
        "source_image_url": _seed_image((i % 50) + 1),
        "source_url": "https://wat2do.io",
        "category": category,
        "organization": organization,
        "organization_type": "WUSA",
        "school": "uwaterloo",
        "ig_handle": organization.lower().replace(" ", ""),
        "occurrences": [
            {
                "dtstart_utc": _to_iso(start),
                "dtend_utc": _to_iso(end),
                "tz": "America/Toronto",
            }
        ],
    }


SEED_EVENTS = [_seed_event(i, title) for i, title in enumerate(EVENT_TITLES)]


def seed():
    # Refuse to run in production — the 50 seed events use dummy titles
    # and source image paths that do not exist in the production storage
    # bucket (audit M11).  Operators who intentionally need to seed prod
    # must flip the environment flag and accept responsibility.
    if settings.is_production:
        raise RuntimeError("refusing to seed in production")

    sb = get_sb()
    created = 0
    for data in SEED_EVENTS:
        r = sb.table(EVENTS).select("id").eq("title", data["title"]).execute()
        if r.data and len(r.data) > 0:
            continue

        payload = dict(data)
        occurrences = payload.pop("occurrences", [])

        inserted = sb.table(EVENTS).insert(payload).execute()
        if not inserted.data:
            continue
        new_id = inserted.data[0]["id"]
        for occ in occurrences:
            sb.table(EVENT_DATES).insert(
                {
                    "event_id": new_id,
                    "dtstart_utc": occ["dtstart_utc"],
                    "dtend_utc": occ["dtend_utc"],
                    "tz": occ.get("tz", "UTC"),
                }
            ).execute()
        created += 1
    print(f"Seeded {created} new events ({len(SEED_EVENTS)} total in seed list)")
