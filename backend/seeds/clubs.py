from core.config import settings
from core.constants import BUCKET_CLUB_LOGOS
from core.database import get_sb
from core.tables import CLUBS


def _public_url(bucket: str, path: str) -> str | None:
    base = settings.supabase_url
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


_ACADEMIC = "Political and Social Awareness"
_GAMES = "Games, Recreational and Social"
_TECH = "Media, Publications and Web Development"
_ARTS = "Creative Arts, Dance and Music"
_HEALTH = "Health Promotion"

SEED_CLUBS = [
    {
        "club_name": "Pre-Pharmacy, UW",
        "categories": [_HEALTH],
        "club_page": "152",
        "ig": "uwprepharmacy",
        "club_type": "WUSA",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-001.jpg"),
        "school": "University of Waterloo",
    },
    {
        "club_name": "UW Board Games Club",
        "categories": [_GAMES],
        "club_page": "200",
        "ig": "uwboardgames",
        "discord": "uwboardgames",
        "club_type": "WUSA",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-002.jpg"),
        "school": "University of Waterloo",
    },
    {
        "club_name": "UW Computer Science Club",
        "categories": [_ACADEMIC, _TECH],
        "club_page": "310",
        "ig": "uwcsclub",
        "discord": "uwcsclub",
        "club_type": "WUSA",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-003.jpg"),
        "school": "University of Waterloo",
    },
    {
        "club_name": "UW Music Society",
        "categories": [_ARTS],
        "club_page": "420",
        "ig": "uwmusic",
        "club_type": "WUSA",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-004.jpg"),
        "school": "University of Waterloo",
    },
    {
        "club_name": "UW Intramurals",
        "categories": [_HEALTH],
        "club_page": "515",
        "ig": "uwintramurals",
        "club_type": "University",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-005.jpg"),
        "school": "University of Waterloo",
    },
    {
        "club_name": "U of T Computer Science Student Union",
        "categories": [_ACADEMIC, _TECH],
        "club_page": "https://cssu.ca",
        "ig": "cssu_uoft",
        "discord": "cssu_discord",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-001.jpg"),
        "school": "University of Toronto - St. George",
    },
    {
        "club_name": "U of T Board Games Club",
        "categories": [_GAMES],
        "club_page": "https://uoftboardgames.ca",
        "ig": "uoftboardgames",
        "discord": "uoftboardgames",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-002.jpg"),
        "school": "University of Toronto - St. George",
    },
    {
        "club_name": "McGill Computer Science Undergraduate Society",
        "categories": [_ACADEMIC, _TECH],
        "club_page": "https://csusmcgill.ca",
        "ig": "csus_mcgill",
        "discord": "csus_mcgill",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-003.jpg"),
        "school": "McGill University",
    },
    {
        "club_name": "McGill Board Games Club",
        "categories": [_GAMES],
        "club_page": "https://mcgillboardgames.ca",
        "ig": "mcgillboardgames",
        "discord": "mcgillboardgames",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-004.jpg"),
        "school": "McGill University",
    },
    {
        "club_name": "UBC Computer Science Student Society",
        "categories": [_ACADEMIC, _TECH],
        "club_page": "https://ubccsss.ca",
        "ig": "ubccsss",
        "discord": "ubccsss",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-005.jpg"),
        "school": "University of British Columbia",
    },
    {
        "club_name": "UBC Board Games Club",
        "categories": [_GAMES],
        "club_page": "https://ubcboardgames.ca",
        "ig": "ubcboardgames",
        "discord": "ubcboardgames",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-001.jpg"),
        "school": "University of British Columbia",
    },
    {
        "club_name": "McMaster Computer Science Society",
        "categories": [_ACADEMIC, _TECH],
        "club_page": "https://mcmastercss.ca",
        "ig": "mcmastercss",
        "discord": "mcmastercss",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-002.jpg"),
        "school": "McMaster University",
    },
    {
        "club_name": "McMaster Board Games Club",
        "categories": [_GAMES],
        "club_page": "https://mcmasterboardgames.ca",
        "ig": "mcmasterboardgames",
        "discord": "mcmasterboardgames",
        "club_type": "Independent",
        "logo_url": _public_url(BUCKET_CLUB_LOGOS, "seed/logo-003.jpg"),
        "school": "McMaster University",
    },
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
