# Migrations

All schema changes live in this directory. Owned by the Supabase CLI —
the FastAPI runtime only reads/writes via PostgREST.

- Run every CLI command from inside `backend/` so it finds both
  `./supabase/` and the `DATABASE_URL` in `.env`.
- The checked-in config currently requires a newer CLI than the globally
  installed `2.51.0`; use `npx supabase@latest ...` or upgrade the local CLI.
- File name format: `YYYYMMDDHHMMSS_descriptive_name.sql`.
- Never edit an already-applied migration. Write a new one.
- No automatic down-migrations — rollbacks are forward
  (`DROP TABLE IF EXISTS foo;`).

## Why this README exists

The runtime connects with the **service-role key**, which bypasses RLS.
Every existing table enables RLS with no permissive policies so the
anon / authenticated roles are blocked from reaching tables directly.
The public schema grants are also locked down so backend service-role access is
the intentional table API; add narrow RLS policies only for deliberate direct
Supabase-client features.

> Forgetting `ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;` on a new
> table ships a table that is silently readable by the anon role the
> moment any code path switches to the anon client.

That's why the skeleton below leads with RLS. Copy it when you add a
new table — the guardrail should survive muscle memory.

## New-table migration skeleton

```sql
-- Migration: add_<resource>_table
-- Created: YYYY-MM-DD
--
-- Short paragraph explaining what this table is for and why it's being
-- added. If the feature has a ticket / audit note, cite it here.
--
-- Fully idempotent: every statement guarded with IF NOT EXISTS or a
-- pg_constraint lookup so re-runs are safe.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.<resource> (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid NOT NULL,  -- or created_by — see ownership convention
    -- …resource columns here…
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    -- All CHECK constraints live inline in CREATE TABLE so re-runs are
    -- equivalent (you can't re-ADD a named CHECK idempotently without
    -- a pg_constraint lookup).
    CONSTRAINT chk_<resource>_<field>_nonempty CHECK (length(<field>) > 0)
);

-- 2. RLS ---------------------------------------------------------------
-- MANDATORY. The service-role key bypasses RLS, so the runtime is
-- unaffected. But enabling RLS with no policies blocks anon /
-- authenticated roles in case any future code path uses the anon
-- client. Do NOT skip this line.
ALTER TABLE public.<resource> ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
-- ADD CONSTRAINT is not IF NOT EXISTS-safe in older Postgres; guard via
-- pg_constraint lookup so re-runs don't raise.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_<resource>_user_id'
    ) THEN
        ALTER TABLE public.<resource>
            ADD CONSTRAINT fk_<resource>_user_id
            FOREIGN KEY (user_id) REFERENCES public.users(id)
            ON DELETE CASCADE;  -- or SET NULL for moderated resources
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
-- Index every FK column and every column you .order() by at read time.
CREATE INDEX IF NOT EXISTS ix_<resource>_user_id ON public.<resource> (user_id);
CREATE INDEX IF NOT EXISTS ix_<resource>_created_at ON public.<resource> (created_at DESC);

COMMIT;
```

## Backend-side follow-ups (do in the same PR)

These are the application-layer touch-points the migration implies —
the router/service/schema wiring is documented in
`.claude/rules/backend-architecture.md`. The two **must-do-here**
items are:

1. Add the table name to `backend/core/tables.py` as a `Final` constant.
2. Add any user-facing 404 string to `backend/core/errors.py`.

## Existing migrations

| File | Purpose |
|---|---|
| `20260101000000_baseline.sql` | Initial schema snapshot. |
| `20260421010000_sync_schema_delta.sql` | Consolidated 27 previously-unapplied migrations into one idempotent delta. |
| `20260423130000_unify_created_by_to_internal_id.sql` | Collapsed the two ownership conventions onto one (owner column FKs to `users.id`). |
