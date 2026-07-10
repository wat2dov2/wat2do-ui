import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.config import settings
from seeds import events, organizations, users

if __name__ == "__main__":
    # Hard guard: refuse production. No env-var override; intentional
    # production seeding belongs in a migration, not a freehand script.
    if settings.is_production:
        raise RuntimeError("refusing to seed in production")

    users.seed()
    events.seed()
    organizations.seed()
