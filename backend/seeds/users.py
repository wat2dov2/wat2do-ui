from core.database import get_sb
from core.tables import USERS
from services import school_service

SEED_USERS = [
    {
        "email": "alice@example.com",
        "full_name": "Alice Johnson",
        "supabase_auth_id": "seed-alice-001",
        "faculty": "Engineering",
        "school": "uwaterloo",
        "interests": ["hackathons", "AI"],
        "is_first_year": False,
    },
    {
        "email": "bob@example.com",
        "full_name": "Bob Smith",
        "supabase_auth_id": "seed-bob-002",
        "faculty": "Mathematics",
        "school": "uwaterloo",
        "interests": ["gaming", "esports"],
        "is_first_year": True,
    },
    {
        "email": "charlie@example.com",
        "full_name": "Charlie Brown",
        "supabase_auth_id": "seed-charlie-003",
        "faculty": "Arts",
        "school": "uwaterloo",
        "interests": ["music", "dance"],
        "is_first_year": False,
    },
]


def seed():
    sb = get_sb()
    school = school_service.get_school("uwaterloo")
    if school is None:
        raise RuntimeError("Waterloo school seed is missing")
    created = 0
    for data in SEED_USERS:
        r = sb.table(USERS).select("id").eq("email", data["email"]).execute()
        if r.data and len(r.data) > 0:
            continue
        payload = {**data, "school_id": school.id}
        payload.pop("school", None)
        sb.table(USERS).insert(payload).execute()
        created += 1
    print(f"Seeded {created} new users ({len(SEED_USERS)} total in seed list)")
