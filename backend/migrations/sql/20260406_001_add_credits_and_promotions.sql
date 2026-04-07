-- Migration: add credits and promotions tables
-- Created: 2026-04-06

CREATE TABLE IF NOT EXISTS user_credits (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL UNIQUE,
    balance     INTEGER NOT NULL DEFAULT 100,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON user_credits (user_id);

CREATE TABLE IF NOT EXISTS event_promotions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL,
    event_id        INTEGER NOT NULL,
    package         VARCHAR(32) NOT NULL,
    credits_spent   INTEGER NOT NULL,
    start_date      TIMESTAMPTZ NOT NULL DEFAULT now(),
    end_date        TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_promotions_user_id  ON event_promotions (user_id);
CREATE INDEX IF NOT EXISTS idx_event_promotions_event_id ON event_promotions (event_id);
CREATE INDEX IF NOT EXISTS idx_event_promotions_end_date ON event_promotions (end_date);

-- Enable RLS (service_role bypasses; blocks direct anon/authenticated access)
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_promotions ENABLE ROW LEVEL SECURITY;
