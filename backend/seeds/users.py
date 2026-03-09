from sqlalchemy import select

from core.database import async_session
from models.user import User


SEED_USERS = [
    {"email": "alice@example.com", "full_name": "Alice Johnson"},
    {"email": "bob@example.com", "full_name": "Bob Smith"},
    {"email": "charlie@example.com", "full_name": "Charlie Brown"},
]


async def seed():
    async with async_session() as db:
        for data in SEED_USERS:
            existing = await db.execute(
                select(User).where(User.email == data["email"])
            )
            if existing.scalar_one_or_none():
                continue
            db.add(User(**data))
        await db.commit()
        print(f"Seeded {len(SEED_USERS)} users")
