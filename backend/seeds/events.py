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
        "occurrences": [
            {
                "dtstart_utc": _to_iso(datetime(2026, 1, 27, 23, 0, tzinfo=timezone.utc)),
                "dtend_utc": _to_iso(datetime(2026, 1, 28, 1, 30, tzinfo=timezone.utc)),
                "tz": "UTC",
            }
        ],
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
        "occurrences": [
            {
                "dtstart_utc": _to_iso(datetime(2026, 2, 5, 0, 0, tzinfo=timezone.utc)),
                "dtend_utc": _to_iso(datetime(2026, 2, 5, 3, 0, tzinfo=timezone.utc)),
                "tz": "UTC",
            }
        ],
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
        "occurrences": [
            {
                "dtstart_utc": _to_iso(datetime(2026, 3, 12, 14, 0, tzinfo=timezone.utc)),
                "dtend_utc": _to_iso(datetime(2026, 3, 12, 18, 0, tzinfo=timezone.utc)),
                "tz": "UTC",
            }
        ],
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
    SEED_EVENTS.append(
        {
            "title": f"Seed Event {i:02d}: {cat}",
            "description": f"A seeded {cat.lower()} event hosted by {org}.",
            "location": ["SLC Great Hall", "DC 1351", "HH 138", "PAC Gym", "E7 Atrium"][
                (i - 4) % 5
            ],
            "occurrences": [
                {
                    "dtstart_utc": _to_iso(start),
                    "dtend_utc": _to_iso(end),
                    "tz": "UTC",
                }
            ],
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


def seed():
    # Refuse to run in production — the 30 seed events use dummy titles
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
