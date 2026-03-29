from datetime import datetime, timezone, timedelta
import os

from dotenv import load_dotenv

from core.database import get_sb

load_dotenv()


def _public_url(bucket: str, path: str) -> str | None:
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


def _seed_image(i: int) -> str | None:
    return _public_url("event-images", f"seed/event-{i:03d}.jpg")


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


BASE = datetime(2026, 3, 10, 18, 0, tzinfo=timezone.utc)
ORGS = [
    "UW Board Games Club",
    "UW Computer Science Club",
    "Pre-Pharmacy, UW",
    "UW Music Society",
    "UW Intramurals",
]
# Use canonical categories (same 22 as frontend). Pick a subset for seed variety.
CATEGORIES = ["Academics", "Games", "Career", "Culture", "Sports", "Technology", "Food"]


SEED_EVENTS = [
    {
        "title": "UWMUN Events",
        "description": "UWMUN is back for the winter term!",
        "location": "HH 138",
        "dtstart_utc": _to_iso(datetime(2026, 1, 27, 23, 0, tzinfo=timezone.utc)),
        "dtend_utc": _to_iso(datetime(2026, 1, 28, 1, 30, tzinfo=timezone.utc)),
        "registration": False,
        "club_type": "WUSA",
        "school": "University of Waterloo",
        "organization": "UWMUN",
        "ig_handle": "uwmun",
        "display_handle": "uwmun",
        "category": "Academics",
        "source_image_url": _seed_image(1),
    },
    {
        "title": "Board Game Night",
        "description": "Join us for board games and snacks!",
        "location": "SLC Great Hall",
        "dtstart_utc": _to_iso(datetime(2026, 2, 5, 0, 0, tzinfo=timezone.utc)),
        "dtend_utc": _to_iso(datetime(2026, 2, 5, 3, 0, tzinfo=timezone.utc)),
        "food": ["pizza", "chips"],
        "price": 0,
        "registration": False,
        "club_type": "WUSA",
        "school": "University of Waterloo",
        "organization": "UW Board Games Club",
        "display_handle": "uwboardgames",
        "category": "Games",
        "source_image_url": _seed_image(2),
    },
    {
        "title": "Tech Career Fair",
        "description": "Meet top tech employers recruiting UW students.",
        "location": "DC 1351",
        "dtstart_utc": _to_iso(datetime(2026, 3, 12, 14, 0, tzinfo=timezone.utc)),
        "dtend_utc": _to_iso(datetime(2026, 3, 12, 18, 0, tzinfo=timezone.utc)),
        "registration": True,
        "club_type": "University",
        "school": "University of Waterloo",
        "category": "Career",
        "organization": "UW Career Centre",
        "source_image_url": _seed_image(3),
    },
]

for i in range(4, 31):
    org = ORGS[(i - 4) % len(ORGS)]
    cat = CATEGORIES[(i - 4) % len(CATEGORIES)]
    start = BASE + timedelta(days=i - 4, hours=((i - 4) % 5) * 2)
    end = start + timedelta(hours=2)
    SEED_EVENTS.append({
        "title": f"Seed Event {i:02d}: {cat}",
        "description": f"A seeded {cat.lower()} event hosted by {org}.",
        "location": ["SLC Great Hall", "DC 1351", "HH 138", "PAC Gym", "E7 Atrium"][(i - 4) % 5],
        "dtstart_utc": _to_iso(start),
        "dtend_utc": _to_iso(end),
        "registration": (i % 3 == 0),
        "club_type": "WUSA" if "UW" in org else "University",
        "school": "University of Waterloo",
        "category": cat,
        "organization": org,
        "price": 0 if i % 4 else 5,
        "food": ["pizza"] if i % 5 == 0 else [],
        "source_image_url": _seed_image(i),
        "display_handle": org.lower().replace(" ", "")[:24],
    })


def seed():
    sb = get_sb()
    created = 0
    for data in SEED_EVENTS:
        r = sb.table("events").select("id").eq("title", data["title"]).execute()
        if r.data and len(r.data) > 0:
            continue
        sb.table("events").insert(data).execute()
        created += 1
    print(f"Seeded {created} new events ({len(SEED_EVENTS)} total in seed list)")
