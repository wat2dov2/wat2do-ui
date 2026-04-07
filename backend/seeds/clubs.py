from core.config import settings
from core.constants import BUCKET_CLUB_LOGOS
from core.database import get_sb
from core.tables import CLUBS


def _public_url(bucket: str, path: str) -> str | None:
    base = settings.supabase_url
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


SEED_CLUBS = [
    {"club_name": "Pre-Pharmacy, UW", "categories": ["Academic"], "club_page": "152", "ig": "uwprepharmacy", "club_type": "WUSA", "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-001.jpg")},
    {"club_name": "UW Board Games Club", "categories": ["Social & Games"], "club_page": "200", "ig": "uwboardgames", "discord": "uwboardgames", "club_type": "WUSA", "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-002.jpg")},
    {"club_name": "UW Computer Science Club", "categories": ["Academic", "Technology"], "club_page": "310", "ig": "uwcsclub", "discord": "uwcsclub", "club_type": "WUSA", "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-003.jpg")},
    {"club_name": "UW Music Society", "categories": ["Cultural"], "club_page": "420", "ig": "uwmusic", "club_type": "WUSA", "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-004.jpg")},
    {"club_name": "UW Intramurals", "categories": ["Sports"], "club_page": "515", "ig": "uwintramurals", "club_type": "University", "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-005.jpg")},
]


def seed():
    sb = get_sb()
    created = 0
    for data in SEED_CLUBS:
        r = sb.table(CLUBS).select("id").eq("club_name", data["club_name"]).execute()
        if r.data and len(r.data) > 0:
            continue
        sb.table(CLUBS).insert(data).execute()
        created += 1
    print(f"Seeded {created} new clubs ({len(SEED_CLUBS)} total in seed list)")
