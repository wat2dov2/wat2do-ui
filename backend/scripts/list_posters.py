#!/usr/bin/env python3
"""List poster IDs from qr_codes table. Usage: python scripts/list_posters.py"""

import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import select

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import async_session
from models.qr_code import QrCode


async def main() -> None:
    async with async_session() as db:
        rows = (await db.execute(select(QrCode.id, QrCode.name, QrCode.is_active))).all()
    if not rows:
        print("No posters in database.")
        return
    for id_, name, is_active in rows:
        print(f"{id_}\t{name}\tactive={is_active}")


if __name__ == "__main__":
    asyncio.run(main())
