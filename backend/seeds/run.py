import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seeds import users, events, clubs

if __name__ == "__main__":
    users.seed()
    events.seed()
    clubs.seed()
