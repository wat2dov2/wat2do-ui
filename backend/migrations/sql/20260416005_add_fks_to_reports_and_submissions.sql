-- Migration: add missing FKs for reported_events and event_submissions
-- Created: 2026-04-16
-- Depends on: 20260406_002_add_admin_tables, 20260409031953_add_missing_fks_and_checks
--
-- Problem (audit I2, I20): the admin tables (reported_events, event_submissions)
-- store user_id / event_id columns without FOREIGN KEY constraints.  An admin
-- (or an attacker with a compromised admin token) can insert rows referencing
-- non-existent users or events, filling the review queue with ghosts.  Also,
-- when a user is deleted from public.users their submissions and reports
-- become orphans (the user_id column still references a now-missing UUID).
--
-- Design decisions:
--   * reported_events.event_id -> events(id) ON DELETE CASCADE.
--       Reports for a deleted event have no actionable value; cascading keeps
--       the table clean and mirrors the user_interactions / user_saved_events
--       cascade semantics added in 20260409033624.
--   * reported_events.user_id  -> users(id)  ON DELETE CASCADE.
--       The reporter's identity is load-bearing for admin review; we cannot
--       SET NULL without corrupting the audit trail.  Cascade keeps the
--       database tidy on user deletion while accepting that reports die
--       with their author.
--   * event_submissions.user_id -> users(id) ON DELETE CASCADE.
--       Same rationale as reported_events.user_id — a submission is tied to
--       its submitter.
--   * event_submissions has NO event_id column (submissions carry a JSON
--       payload, not a reference to an existing event), so no event_id FK
--       is needed here.
--
-- Safety:
--   * Orphaned rows are deleted BEFORE adding FK constraints so ADD CONSTRAINT
--     does not fail on existing data.
--   * Each ALTER TABLE is wrapped in a DO $$ block that checks pg_constraint
--     before adding the constraint, so the migration is idempotent.

-- =========================================================================
-- 1. reported_events.event_id -> events(id) ON DELETE CASCADE
-- =========================================================================

-- 1a. Clean up orphaned rows
DELETE FROM reported_events
WHERE event_id NOT IN (SELECT id FROM events);

-- 1b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_reported_events_event_id'
    ) THEN
        ALTER TABLE reported_events
            ADD CONSTRAINT fk_reported_events_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 2. reported_events.user_id -> users(id) ON DELETE CASCADE
-- =========================================================================

-- 2a. Clean up orphaned rows
DELETE FROM reported_events
WHERE user_id NOT IN (SELECT id FROM users);

-- 2b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_reported_events_user_id'
    ) THEN
        ALTER TABLE reported_events
            ADD CONSTRAINT fk_reported_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- =========================================================================
-- 3. event_submissions.user_id -> users(id) ON DELETE CASCADE
-- =========================================================================

-- 3a. Clean up orphaned rows
DELETE FROM event_submissions
WHERE user_id NOT IN (SELECT id FROM users);

-- 3b. Add FK
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_submissions_user_id'
    ) THEN
        ALTER TABLE event_submissions
            ADD CONSTRAINT fk_event_submissions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
