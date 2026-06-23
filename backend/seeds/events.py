from core.config import settings


def seed():
    # Event mock rows are production-visible data, so they live in the
    # idempotent Supabase migration instead of this freehand seed script.
    if settings.is_production:
        raise RuntimeError("refusing to seed in production")

    print(
        "Event mock data is managed by "
        "backend/supabase/migrations/20260623090000_seed_mock_upcoming_events.sql"
    )
