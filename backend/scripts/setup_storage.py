#!/usr/bin/env python3
"""
Set up Supabase Storage buckets and RLS policies via direct SQL.

Usage:
    python scripts/setup_storage.py
"""

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from dotenv import load_dotenv

load_dotenv()

SQL_FILE = Path(__file__).resolve().parent / "setup_storage.sql"


def split_sql(text: str) -> list[str]:
    """Split SQL into statements, respecting DO $$ ... $$ blocks."""
    stmts: list[str] = []
    buf = ""
    in_dollar = False

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue

        buf += line + "\n"

        if "$$" in line:
            count = line.count("$$")
            if count % 2 == 1:
                in_dollar = not in_dollar

        if not in_dollar and stripped.endswith(";"):
            stmts.append(buf.strip())
            buf = ""

    if buf.strip():
        stmts.append(buf.strip())

    return stmts


def main() -> None:
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    sync_url = db_url.replace("+asyncpg", "").replace("+aiopg", "")

    import sqlalchemy

    sql = SQL_FILE.read_text()
    stmts = split_sql(sql)
    engine = sqlalchemy.create_engine(sync_url)

    print(f"Running {len(stmts)} SQL statements...\n")

    ok = 0
    skipped = 0
    failed = 0

    with engine.connect() as conn:
        for stmt in stmts:
            try:
                conn.execute(sqlalchemy.text(stmt))
                conn.commit()
                ok += 1
            except Exception as e:
                conn.rollback()
                msg = str(e)
                if "already exists" in msg or "duplicate" in msg.lower():
                    skipped += 1
                else:
                    short = re.sub(r"\s+", " ", msg)[:150]
                    print(f"  WARN: {short}")
                    failed += 1

    print(f"\nDone: {ok} applied, {skipped} already existed, {failed} failed.")
    if failed:
        sys.exit(1)
    else:
        print("Storage is ready.")


if __name__ == "__main__":
    main()
