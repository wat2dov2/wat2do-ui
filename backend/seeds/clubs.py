from sqlalchemy import select

from core.database import async_session
from models.club import Club

import os
from dotenv import load_dotenv

load_dotenv()


def _public_url(bucket: str, path: str) -> str | None:
    base = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


SEED_CLUBS = [
    {
        "club_name": "Pre-Pharmacy, UW",
        "categories": ["Academic"],
        "club_page": "152",
        "ig": "uwprepharmacy",
        "club_type": "WUSA",
        "logo_url": _public_url("club-logos", "seed/logo-001.jpg"),
    },
    {
        "club_name": "UW Board Games Club",
        "categories": ["Social & Games"],
        "club_page": "200",
        "ig": "uwboardgames",
        "discord": "uwboardgames",
        "club_type": "WUSA",
        "logo_url": _public_url("club-logos", "seed/logo-002.jpg"),
    },
    {
        "club_name": "UW Computer Science Club",
        "categories": ["Academic", "Technology"],
        "club_page": "310",
        "ig": "uwcsclub",
        "discord": "uwcsclub",
        "club_type": "WUSA",
        "logo_url": _public_url("club-logos", "seed/logo-003.jpg"),
    },
    {
        "club_name": "UW Music Society",
        "categories": ["Cultural"],
        "club_page": "420",
        "ig": "uwmusic",
        "club_type": "WUSA",
        "logo_url": _public_url("club-logos", "seed/logo-004.jpg"),
    },
    {
        "club_name": "UW Intramurals",
        "categories": ["Sports"],
        "club_page": "515",
        "ig": "uwintramurals",
        "club_type": "University",
        "logo_url": _public_url("club-logos", "seed/logo-005.jpg"),
    },
]


async def seed():
    async with async_session() as db:
        created = 0
        for data in SEED_CLUBS:
            existing = await db.execute(
                select(Club).where(Club.club_name == data["club_name"])
            )
            if existing.scalar_one_or_none():
                continue
            db.add(Club(**data))
            created += 1
        await db.commit()
        print(f"Seeded {created} new clubs ({len(SEED_CLUBS)} total in seed list)")
