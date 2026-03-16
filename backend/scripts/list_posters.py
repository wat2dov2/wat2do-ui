#!/usr/bin/env python3
"""List poster IDs from qr_codes table. Usage: python scripts/list_posters.py"""

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.database import get_sb


def main() -> None:
    r = get_sb().table("qr_codes").select("id, name, is_active").execute()
    rows = r.data or []
    if not rows:
        print("No posters in database.")
        return
    for row in rows:
        print(f"{row['id']}\t{row['name']}\tactive={row.get('is_active', False)}")


if __name__ == "__main__":
    main()
