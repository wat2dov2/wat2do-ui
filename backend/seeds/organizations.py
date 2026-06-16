from core.config import settings
from core.database import get_sb
from core.tables import ORGANIZATIONS


def _public_url(bucket: str, path: str) -> str | None:
    base = settings.supabase_url
    if not base:
        return None
    return f"{base}/storage/v1/object/public/{bucket}/{path}"


_ACADEMIC = "Politics & Advocacy"
_GAMES = "Games & Recreation"
_TECH = "Media & Web"
_ARTS = "Arts & Culture"
_HEALTH = "Health"

SEED_ORGANIZATIONS = []


def seed():
    sb = get_sb()
    created = 0
    for data in SEED_ORGANIZATIONS:
        r = (
            sb.table(ORGANIZATIONS)
            .select("id")
            .eq("organization_name", data["organization_name"])
            .execute()
        )
        if r.data and len(r.data) > 0:
            continue
        sb.table(ORGANIZATIONS).insert(data).execute()
        created += 1
    print(f"Seeded {created} new organizations ({len(SEED_ORGANIZATIONS)} total in seed list)")
