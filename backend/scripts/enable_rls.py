"""
Enable RLS on all public tables and drop overly-permissive policies.

After this script:
  - Every table has RLS enabled
  - No permissive policies exist for anon/authenticated/public
  - Only the service_role key (used by FastAPI) can access data
  - Direct PostgREST access via anon or authenticated key is blocked

Run:  .venv/bin/python scripts/enable_rls.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import psycopg2  # noqa: E402
from core.config import settings  # noqa: E402


def main():
    conn = psycopg2.connect(settings.database_url)
    conn.autocommit = True
    cur = conn.cursor()

    # ── 1. Find all public tables ────────────────────────────────────
    cur.execute("""
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename != 'alembic_version'
        ORDER BY tablename
    """)
    tables = cur.fetchall()

    # ── 2. Drop existing wide-open policies ──────────────────────────
    cur.execute("""
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
    """)
    policies = cur.fetchall()

    for table, policy in policies:
        print(f"  DROP POLICY {policy!r} ON {table}")
        cur.execute(f'DROP POLICY IF EXISTS "{policy}" ON "{table}"')

    # ── 3. Enable RLS on every table ─────────────────────────────────
    for table, has_rls in tables:
        if not has_rls:
            print(f"  ENABLE RLS on {table}")
        else:
            print(f"  RLS already on {table}")
        cur.execute(f'ALTER TABLE "{table}" ENABLE ROW LEVEL SECURITY')

    # ── 4. Verify ────────────────────────────────────────────────────
    print()
    cur.execute("""
        SELECT tablename, rowsecurity
        FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename != 'alembic_version'
        ORDER BY tablename
    """)
    print("Final state:")
    for table, rls in cur.fetchall():
        status = "RLS ON" if rls else "NO RLS"
        print(f"  {status} — {table}")

    cur.execute("""
        SELECT count(*) FROM pg_policies WHERE schemaname = 'public'
    """)
    count = cur.fetchone()[0]
    print(f"\nPolicies remaining: {count}")

    conn.close()
    print("\nDone. Only the service_role key can access these tables now.")


if __name__ == "__main__":
    main()
