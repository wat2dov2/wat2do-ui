-- Migration: add missing event_id foreign keys
-- Created: 2026-04-09
-- Depends on: 20260406_000_create_recommendation_tables,
--             20260409031953_add_missing_fks_and_checks
--
-- Problem: four tables store event_id columns without FOREIGN KEY constraints
-- referencing events(id).  Deleting an event hard-deletes the row (there is no
-- soft-delete mechanism) but leaves orphaned rows in:
--
--   user_interactions    — interaction logs referencing non-existent events
--   user_saved_events    — saved bookmarks for deleted events
--   user_recommendations — pre-computed recs pointing at deleted events
--   ab_test_events       — A/B test impressions/clicks for deleted events
--
-- The earlier "add_missing_fks_and_checks" migration (20260409031953) added
-- user_id FKs and the event_promotions.event_id FK, but missed event_id on
-- these four tables.
--
-- Design decisions:
--   * user_interactions.event_id  → ON DELETE CASCADE.  Interaction rows for a
--     deleted event have no analytical value (the event can't be joined, scored,
--     or displayed).  The nightly recommendation pipeline filters by future
--     events anyway, so stale interactions don't affect live recs.
--   * user_saved_events.event_id  → ON DELETE CASCADE.  A bookmark to a
--     non-existent event is useless and would cause UI errors.
--   * user_recommendations.event_id → ON DELETE CASCADE.  Recs are ephemeral
--     (recomputed nightly) and the live serving path already filters out past
--     events, so cascading is safe and keeps the table clean.
--   * ab_test_events.event_id → ON DELETE SET NULL.  A/B test rows are used
--     for aggregate CTR metrics (impressions vs clicks by variant).  Deleting
--     the event shouldn't destroy the statistical record.  The column is
--     currently NOT NULL, so we first relax it to nullable — consistent with
--     how user_id was handled in the previous FK migration.
--
-- Safety:
--   * Orphaned rows are deleted BEFORE adding FK constraints so that
--     ADD CONSTRAINT does not fail on existing data.
--   * Each ALTER TABLE uses DO $$ blocks with pg_constraint checks to be
--     safely re-runnable (idempotent).

-- =========================================================================
-- 1. user_interactions.event_id → events(id) ON DELETE CASCADE
-- =========================================================================

-- 1a. Clean up orphaned rows
DELETE FROM user_interactions
WHERE event_id NOT IN (SELECT id FROM events);

-- 1b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_interactions_event_id'
    ) THEN
        ALTER TABLE user_interactions
            ADD CONSTRAINT fk_user_interactions_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 2. user_saved_events.event_id → events(id) ON DELETE CASCADE
-- =========================================================================

-- 2a. Clean up orphaned rows
DELETE FROM user_saved_events
WHERE event_id NOT IN (SELECT id FROM events);

-- 2b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_saved_events_event_id'
    ) THEN
        ALTER TABLE user_saved_events
            ADD CONSTRAINT fk_user_saved_events_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 3. user_recommendations.event_id → events(id) ON DELETE CASCADE
-- =========================================================================

-- 3a. Clean up orphaned rows
DELETE FROM user_recommendations
WHERE event_id NOT IN (SELECT id FROM events);

-- 3b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_recommendations_event_id'
    ) THEN
        ALTER TABLE user_recommendations
            ADD CONSTRAINT fk_user_recommendations_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 4. ab_test_events.event_id → events(id) ON DELETE SET NULL
-- =========================================================================

-- 4a. Clean up orphaned rows
DELETE FROM ab_test_events
WHERE event_id NOT IN (SELECT id FROM events);

-- 4b. Allow NULL event_id so that ON DELETE SET NULL works.
--     The column was originally NOT NULL; we relax it to preserve aggregate
--     CTR metrics after event deletion (same pattern as user_id in the
--     previous FK migration).
ALTER TABLE ab_test_events
    ALTER COLUMN event_id DROP NOT NULL;

-- 4c. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ab_test_events_event_id'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT fk_ab_test_events_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
    END IF;
END $$;
