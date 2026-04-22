-- Migration: clean invalid JSON in clubs.discord and reinforce backfill
-- Created: 2026-04-17
--
-- Fixes audit finding D14: the club_integrations backfill in
-- 20260407010943_create_club_integrations_table.sql selects
--     c.discord::jsonb
-- under the guard `c.discord LIKE '{%'`.  A legacy row whose discord
-- field starts with '{' but contains invalid JSON (e.g. '{not json')
-- aborts the whole migration file — the CREATE TABLE + RLS enable
-- already ran, but the backfill INSERTs are rolled back and the
-- migration is permanently marked failed.  Per scripts/migrate.py:93-106
-- the runner executes the file as one statement and halts on failure.
--
-- Mitigation strategy (applied here, since the historical migration
-- cannot be edited in place):
--   1. NULL out any rows in clubs.discord that look JSON-shaped
--      (start with '{') but fail a jsonb cast.  This purges the
--      booby-trap so any future re-run (or manual rerun of the
--      backfill) cannot trip on them.
--   2. Re-run the three backfill statements with the same ON CONFLICT
--      DO NOTHING semantics — idempotent, picks up any rows that
--      missed the first pass due to the abort.
--   3. Uses a null-safe JSONB-validation helper implemented as an
--      inline DO block with EXCEPTION WHEN invalid_text_representation
--      so malformed JSON does not propagate.
--
-- Safe to apply multiple times: the DO block short-circuits after the
-- first run (no rows to clean), and the INSERT statements are ON
-- CONFLICT DO NOTHING.

-- ── 1. Null out unparseable JSON-shaped discord values ──────────────
-- Walk each candidate row individually so a single bad cast cannot
-- abort the whole statement.
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, discord
        FROM clubs
        WHERE discord IS NOT NULL
          AND discord LIKE '{%'
    LOOP
        BEGIN
            PERFORM r.discord::jsonb;
        EXCEPTION
            WHEN invalid_text_representation OR others THEN
                UPDATE clubs SET discord = NULL WHERE id = r.id;
        END;
    END LOOP;
END $$;

-- ── 2. Re-run the three backfill formats (idempotent) ───────────────
-- Format 3: _integrations envelope
INSERT INTO club_integrations (club_id, platform, connected, name, last_sync,
    server_id, server_name, channel_id, channel_name,
    handle, group_id, group_name, page_id, page_name, connection_type)
SELECT
    c.id,
    kv.key AS platform,
    COALESCE((kv.value->>'connected')::boolean, false),
    kv.value->>'name',
    CASE WHEN kv.value->>'last_sync' IS NOT NULL
         THEN (kv.value->>'last_sync')::timestamptz
         ELSE NULL END,
    COALESCE(kv.value->'metadata'->>'server_id', kv.value->'metadata'->>'workspace_id'),
    COALESCE(kv.value->'metadata'->>'server_name', kv.value->'metadata'->>'workspace_name'),
    kv.value->'metadata'->>'channel_id',
    kv.value->'metadata'->>'channel_name',
    kv.value->'metadata'->>'handle',
    kv.value->'metadata'->>'group_id',
    kv.value->'metadata'->>'group_name',
    kv.value->'metadata'->>'page_id',
    kv.value->'metadata'->>'page_name',
    kv.value->'metadata'->>'connection_type'
FROM clubs c,
     LATERAL jsonb_each((c.discord::jsonb)->'_integrations') AS kv(key, value)
WHERE c.discord IS NOT NULL
  AND c.discord LIKE '{%'
  AND (c.discord::jsonb) ? '_integrations'
ON CONFLICT (club_id, platform) DO NOTHING;

-- Format 2: Discord-only JSON
INSERT INTO club_integrations (club_id, platform, connected, name, last_sync,
    server_id, server_name, channel_id, channel_name)
SELECT
    c.id,
    'discord',
    COALESCE((c.discord::jsonb->>'connected')::boolean, true),
    c.discord::jsonb->>'name',
    CASE WHEN c.discord::jsonb->>'last_sync' IS NOT NULL
         THEN (c.discord::jsonb->>'last_sync')::timestamptz
         ELSE NULL END,
    c.discord::jsonb->>'server_id',
    c.discord::jsonb->>'server_name',
    c.discord::jsonb->>'channel_id',
    c.discord::jsonb->>'channel_name'
FROM clubs c
WHERE c.discord IS NOT NULL
  AND c.discord LIKE '{%'
  AND NOT ((c.discord::jsonb) ? '_integrations')
ON CONFLICT (club_id, platform) DO NOTHING;

-- Format 1: Plain string (legacy discord handle/link)
INSERT INTO club_integrations (club_id, platform, connected, name)
SELECT
    c.id,
    'discord',
    true,
    c.discord
FROM clubs c
WHERE c.discord IS NOT NULL
  AND c.discord != ''
  AND NOT (c.discord LIKE '{%')
ON CONFLICT (club_id, platform) DO NOTHING;
