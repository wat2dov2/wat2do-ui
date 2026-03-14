from datetime import datetime, timezone, timedelta
import os

from dotenv import load_dotenv

from sqlalchemy import select

from core.database import async_session
from models.event import Event

load_dotenv()


def _public_url(bucket: str, path: str) -> str | None:
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def _seed_image(i: int) -> str | None:
    return _public_url("event-images", f"seed/event-{i:03d}.jpg")


BASE = datetime(2026, 3, 10, 18, 0, tzinfo=timezone.utc)
ORGS = [
    "UW Board Games Club",
    "UW Computer Science Club",
    "Pre-Pharmacy, UW",
    "UW Music Society",
    "UW Intramurals",
]
CATEGORIES = ["Academic", "Social & Games", "Career", "Cultural", "Sports"]


SEED_EVENTS = [
    {
        "title": "UWMUN Events",
        "description": "UWMUN is back for the winter term!",
        "location": "HH 138",
        "dtstart_utc": datetime(2026, 1, 27, 23, 0, tzinfo=timezone.utc),
        "dtend_utc": datetime(2026, 1, 28, 1, 30, tzinfo=timezone.utc),
        "registration": False,
        "club_type": "WUSA",
        "school": "University of Waterloo",
        "organization": "UWMUN",
        "ig_handle": "uwmun",
        "display_handle": "uwmun",
        "category": "Academic",
        "source_image_url": _seed_image(1),
    },
    {
        "title": "Board Game Night",
        "description": "Join us for board games and snacks!",
        "location": "SLC Great Hall",
        "dtstart_utc": datetime(2026, 2, 5, 0, 0, tzinfo=timezone.utc),
        "dtend_utc": datetime(2026, 2, 5, 3, 0, tzinfo=timezone.utc),
        "food": ["pizza", "chips"],
        "price": 0,
        "registration": False,
        "club_type": "WUSA",
        "school": "University of Waterloo",
        "organization": "UW Board Games Club",
        "display_handle": "uwboardgames",
        "category": "Social & Games",
        "source_image_url": _seed_image(2),
    },
    {
        "title": "Tech Career Fair",
        "description": "Meet top tech employers recruiting UW students.",
        "location": "DC 1351",
        "dtstart_utc": datetime(2026, 3, 12, 14, 0, tzinfo=timezone.utc),
        "dtend_utc": datetime(2026, 3, 12, 18, 0, tzinfo=timezone.utc),
        "registration": True,
        "club_type": "University",
        "school": "University of Waterloo",
        "category": "Career",
        "organization": "UW Career Centre",
        "source_image_url": _seed_image(3),
    },
]

# Add a bunch more seeded events with images so the UI feels realistic.
for i in range(4, 31):
    org = ORGS[(i - 4) % len(ORGS)]
    cat = CATEGORIES[(i - 4) % len(CATEGORIES)]
    start = BASE + timedelta(days=i - 4, hours=((i - 4) % 5) * 2)
    end = start + timedelta(hours=2)
    SEED_EVENTS.append(
        {
            "title": f"Seed Event {i:02d}: {cat}",
            "description": f"A seeded {cat.lower()} event hosted by {org}.",
            "location": ["SLC Great Hall", "DC 1351", "HH 138", "PAC Gym", "E7 Atrium"][
                (i - 4) % 5
            ],
            "dtstart_utc": start,
            "dtend_utc": end,
            "registration": (i % 3 == 0),
            "club_type": "WUSA" if "UW" in org else "University",
            "school": "University of Waterloo",
            "category": cat,
            "organization": org,
            "price": 0 if i % 4 else 5,
            "food": ["pizza"] if i % 5 == 0 else [],
            "source_image_url": _seed_image(i),
            "display_handle": org.lower().replace(" ", "")[:24],
        }
    )


async def seed():
    async with async_session() as db:
        created = 0
        for data in SEED_EVENTS:
            existing = await db.execute(
                select(Event).where(Event.title == data["title"])
            )
            if existing.scalar_one_or_none():
                continue
            db.add(Event(**data))
            created += 1
        await db.commit()
        print(f"Seeded {created} new events ({len(SEED_EVENTS)} total in seed list)")
