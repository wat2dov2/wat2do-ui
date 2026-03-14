from sqlalchemy import select

from core.database import async_session
from models.user import User


SEED_USERS = [
    {
        "email": "alice@example.com",
        "full_name": "Alice Johnson",
        "supabase_auth_id": "seed-alice-001",
        "faculty": "Engineering",
        "school": "University of Waterloo",
        "interests": ["hackathons", "AI"],
        "is_first_year": False,
    },
    {
        "email": "bob@example.com",
        "full_name": "Bob Smith",
        "supabase_auth_id": "seed-bob-002",
        "faculty": "Mathematics",
        "school": "University of Waterloo",
        "interests": ["gaming", "esports"],
        "is_first_year": True,
    },
    {
        "email": "charlie@example.com",
        "full_name": "Charlie Brown",
        "supabase_auth_id": "seed-charlie-003",
        "faculty": "Arts",
        "school": "University of Waterloo",
        "interests": ["music", "dance"],
        "is_first_year": False,
    },
]


async def seed():
    async with async_session() as db:
        created = 0
        for data in SEED_USERS:
            existing = await db.execute(
                select(User).where(User.email == data["email"])
            )
            if existing.scalar_one_or_none():
                continue
            db.add(User(**data))
            created += 1
        await db.commit()
        print(f"Seeded {created} new users ({len(SEED_USERS)} total in seed list)")
