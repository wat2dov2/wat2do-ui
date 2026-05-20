import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import settings
from seeds import clubs, events, users

if __name__ == "__main__":
    # Hard guard — the individual seed() functions also check, but keep a
    # top-level refusal so operators can't trip the seed script at all on
    # a production box (audit M11).  No env-var override: intentional
    # production seeding belongs in a migration, not a freehand script.
    if settings.is_production:
        raise RuntimeError("refusing to seed in production")

    users.seed()
    events.seed()
    clubs.seed()
