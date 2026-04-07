-- Migration: add event submissions, reported events, and scraped events tables
-- Created: 2026-04-06

CREATE TABLE IF NOT EXISTS event_submissions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL,
    event_data        JSONB NOT NULL,
    status            VARCHAR(16) NOT NULL DEFAULT 'pending',
    rejection_reason  TEXT,
    submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_event_submissions_user_id ON event_submissions (user_id);
CREATE INDEX IF NOT EXISTS idx_event_submissions_status  ON event_submissions (status);

CREATE TABLE IF NOT EXISTS reported_events (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id    INTEGER NOT NULL,
    user_id     UUID NOT NULL,
    reason      TEXT NOT NULL,
    status      VARCHAR(16) NOT NULL DEFAULT 'pending',
    reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reported_events_event_id ON reported_events (event_id);
CREATE INDEX IF NOT EXISTS idx_reported_events_status   ON reported_events (status);

CREATE TABLE IF NOT EXISTS scraped_events (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id   INTEGER,
    source     VARCHAR(255) NOT NULL,
    scraped_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw_data   JSONB
);
CREATE INDEX IF NOT EXISTS idx_scraped_events_source ON scraped_events (source);

-- Enable RLS (service_role bypasses; blocks direct anon/authenticated access)
ALTER TABLE event_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reported_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE scraped_events ENABLE ROW LEVEL SECURITY;
