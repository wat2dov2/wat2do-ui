from core.database import get_sb
from core.tables import ORGANIZATIONS

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
