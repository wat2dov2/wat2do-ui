-- Migration: create recommendation engine tables
-- Created: 2026-04-06
--
-- These tables were originally created outside the migration system
-- (scripts/create_recommendation_tables.sql). This migration brings them into
-- the sequence so fresh environments work without manual SQL.
-- All statements are idempotent (IF NOT EXISTS) for safety on existing DBs.

-- 1. user_interactions: raw interaction events (views, clicks, saves, shares)
CREATE TABLE IF NOT EXISTS user_interactions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id      varchar(255) NOT NULL,
    event_id        integer NOT NULL,
    interaction_type varchar(32) NOT NULL,
    metadata        jsonb,
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_user_interactions_user_event ON user_interactions (user_id, event_id);
CREATE INDEX IF NOT EXISTS ix_user_interactions_event_id ON user_interactions (event_id);
CREATE INDEX IF NOT EXISTS ix_user_interactions_created_at ON user_interactions (created_at);

-- 2. user_saved_events: bookmarks
CREATE TABLE IF NOT EXISTS user_saved_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_id    integer NOT NULL,
    saved_at    timestamptz DEFAULT now(),
    UNIQUE (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS ix_user_saved_events_user_id ON user_saved_events (user_id);

-- 3. user_recommendations: pre-computed nightly results
CREATE TABLE IF NOT EXISTS user_recommendations (
    user_id         uuid NOT NULL,
    event_id        integer NOT NULL,
    rank            integer NOT NULL,
    predicted_score float NOT NULL,
    reason          varchar(255),
    computed_at     timestamptz DEFAULT now(),
    PRIMARY KEY (user_id, event_id)
);

CREATE INDEX IF NOT EXISTS ix_user_recommendations_user_rank ON user_recommendations (user_id, rank);

-- 4. ab_test_events: A/B test tracking
CREATE TABLE IF NOT EXISTS ab_test_events (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL,
    event_id    integer NOT NULL,
    variant     varchar(32) NOT NULL,
    event_type  varchar(32) NOT NULL,
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_ab_test_events_variant ON ab_test_events (variant);

-- Enable RLS on all tables (required by project policy)
ALTER TABLE user_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_test_events ENABLE ROW LEVEL SECURITY;
