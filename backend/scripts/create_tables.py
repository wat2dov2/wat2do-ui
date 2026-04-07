"""
Create tables for credits, promotions, submissions, reports, and scraped events.
Run from the backend directory:
    .venv/bin/python scripts/create_tables.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2  # noqa: E402
from core.config import settings  # noqa: E402

STATEMENTS = [
    # ── user_credits ─────────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS user_credits (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id     UUID NOT NULL UNIQUE,
        balance     INTEGER NOT NULL DEFAULT 100,
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits (user_id)",

    # ── event_promotions ─────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS event_promotions (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID NOT NULL,
        event_id        INTEGER NOT NULL,
        package         VARCHAR(32) NOT NULL,
        credits_spent   INTEGER NOT NULL,
        start_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
        end_date        TIMESTAMPTZ NOT NULL,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_event_promotions_user_id  ON event_promotions (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_event_promotions_event_id ON event_promotions (event_id)",
    "CREATE INDEX IF NOT EXISTS idx_event_promotions_end_date ON event_promotions (end_date)",

    # ── event_submissions ────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS event_submissions (
        id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id           UUID NOT NULL,
        event_data        JSONB NOT NULL,
        status            VARCHAR(16) NOT NULL DEFAULT 'pending',
        rejection_reason  TEXT,
        submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        reviewed_at       TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_event_submissions_user_id ON event_submissions (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_event_submissions_status  ON event_submissions (status)",

    # ── reported_events ──────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS reported_events (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id    INTEGER NOT NULL,
        user_id     UUID NOT NULL,
        reason      TEXT NOT NULL,
        status      VARCHAR(16) NOT NULL DEFAULT 'pending',
        reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at TIMESTAMPTZ
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_reported_events_event_id ON reported_events (event_id)",
    "CREATE INDEX IF NOT EXISTS idx_reported_events_status   ON reported_events (status)",

    # ── scraped_events ───────────────────────────────────────────────
    """
    CREATE TABLE IF NOT EXISTS scraped_events (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id   INTEGER,
        source     VARCHAR(255) NOT NULL,
        scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        raw_data   JSONB
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_scraped_events_source ON scraped_events (source)",
]


def main():
    print(f"Connecting to database...")
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = True

    with conn.cursor() as cur:
        for stmt in STATEMENTS:
            stmt = stmt.strip()
            if not stmt:
                continue
            # Extract a short label for logging
            label = stmt.split("\n")[0].strip()[:60]
            try:
                cur.execute(stmt)
                print(f"  OK: {label}")
            except Exception as e:
                print(f"  FAIL: {label} — {e}")

    conn.close()
    print("Done.")


if __name__ == "__main__":
    main()
