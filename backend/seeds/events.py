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
# Use canonical categories (same 22 as frontend). Pick a subset for seed variety.
CATEGORIES = ["Arts & Culture", "Business", "Games & Recreation", "Media & Web"]


SEED_EVENTS = []


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
