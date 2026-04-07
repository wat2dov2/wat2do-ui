"""
Simple SQL migration runner using psycopg2.

Tracks applied migrations in a `schema_migrations` table.
Migration files live in backend/migrations/sql/ as numbered .sql files.

Usage:
    .venv/bin/python scripts/migrate.py          # apply pending migrations
    .venv/bin/python scripts/migrate.py status    # show migration status
    .venv/bin/python scripts/migrate.py new NAME  # create new migration file
"""

import sys
import os
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2  # noqa: E402
from core.config import settings  # noqa: E402

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent / "migrations" / "sql"


def ensure_tracking_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version     VARCHAR(255) PRIMARY KEY,
            applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    """)


def get_applied(cur) -> set[str]:
    cur.execute("SELECT version FROM schema_migrations ORDER BY version")
    return {row[0] for row in cur.fetchall()}


def get_pending(applied: set[str]) -> list[Path]:
    if not MIGRATIONS_DIR.exists():
        return []
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    return [f for f in files if f.stem not in applied]


def cmd_status():
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = True
    cur = conn.cursor()
    ensure_tracking_table(cur)
    applied = get_applied(cur)
    pending = get_pending(applied)

    if not MIGRATIONS_DIR.exists():
        print("No migrations directory found.")
        conn.close()
        return

    all_files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    for f in all_files:
        status = "applied" if f.stem in applied else "PENDING"
        print(f"  [{status}]  {f.name}")

    if not all_files:
        print("  No migration files found.")
    elif not pending:
        print(f"\nAll {len(applied)} migrations applied.")
    else:
        print(f"\n{len(pending)} pending, {len(applied)} applied.")

    conn.close()


def cmd_apply():
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = False
    cur = conn.cursor()
    ensure_tracking_table(cur)
    conn.commit()

    applied = get_applied(cur)
    pending = get_pending(applied)

    if not pending:
        print("No pending migrations.")
        conn.close()
        return

    for f in pending:
        sql = f.read_text()
        print(f"  Applying {f.name}...")
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (version) VALUES (%s)",
                (f.stem,),
            )
            conn.commit()
            print(f"    OK")
        except Exception as e:
            conn.rollback()
            print(f"    FAILED: {e}")
            print("Aborting. Fix the migration and re-run.")
            conn.close()
            sys.exit(1)

    print(f"\n{len(pending)} migration(s) applied.")
    conn.close()


def cmd_new(name: str):
    MIGRATIONS_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    slug = name.lower().replace(" ", "_").replace("-", "_")
    filename = f"{timestamp}_{slug}.sql"
    path = MIGRATIONS_DIR / filename

    path.write_text(f"-- Migration: {name}\n-- Created: {datetime.now(timezone.utc).isoformat()}\n\n")
    print(f"Created: {path}")


def main():
    args = sys.argv[1:]

    if not args or args[0] == "apply":
        cmd_apply()
    elif args[0] == "status":
        cmd_status()
    elif args[0] == "new" and len(args) >= 2:
        cmd_new(" ".join(args[1:]))
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
