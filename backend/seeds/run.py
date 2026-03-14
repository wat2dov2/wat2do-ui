import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from seeds import users, events, clubs


async def main():
    await users.seed()
    await events.seed()
    await clubs.seed()


if __name__ == "__main__":
    asyncio.run(main())
