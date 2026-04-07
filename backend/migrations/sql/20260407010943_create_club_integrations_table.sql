-- Migration: create club_integrations table
-- Created: 2026-04-07T01:09:43+00:00
--
-- Normalizes integration data out of the clubs.discord JSON blob
-- into a proper relational table with one row per (club, platform).

CREATE TABLE IF NOT EXISTS club_integrations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id         INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    platform        VARCHAR(32) NOT NULL,
    connected       BOOLEAN NOT NULL DEFAULT FALSE,
    name            TEXT,
    last_sync       TIMESTAMPTZ,
    -- Platform-specific fields stored as typed columns, not a JSON grab-bag.
    -- Server/workspace-style integrations (Discord, Slack):
    server_id       TEXT,
    server_name     TEXT,
    channel_id      TEXT,
    channel_name    TEXT,
    -- Handle-based integrations (Instagram):
    handle          TEXT,
    -- Group-based integrations (Telegram, Facebook groups):
    group_id        TEXT,
    group_name      TEXT,
    -- Page-based integrations (LinkedIn, Facebook pages):
    page_id         TEXT,
    page_name       TEXT,
    -- Facebook distinguishes page vs group connection:
    connection_type VARCHAR(16),
    -- Escape hatch for truly platform-specific data we haven't anticipated:
    extra           JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (club_id, platform)
);

CREATE INDEX IF NOT EXISTS idx_club_integrations_club_id ON club_integrations (club_id);
CREATE INDEX IF NOT EXISTS idx_club_integrations_platform ON club_integrations (platform);
CREATE INDEX IF NOT EXISTS idx_club_integrations_connected ON club_integrations (connected);

-- Migrate existing data from clubs.discord JSON blob into the new table.
-- Handles three legacy formats:
--   1. Plain string (legacy discord handle)
--   2. Discord-only JSON (server_id, channel_id, etc.)
--   3. _integrations envelope JSON with multiple platforms

-- Format 3: _integrations envelope
-- Note: Slack stored workspace_id/workspace_name in metadata; these map
-- to the server_id/server_name columns via COALESCE.
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

-- Format 2: Discord-only JSON (has server_id but no _integrations key)
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

-- Enable RLS (service_role bypasses; blocks direct anon/authenticated access)
ALTER TABLE club_integrations ENABLE ROW LEVEL SECURITY;
