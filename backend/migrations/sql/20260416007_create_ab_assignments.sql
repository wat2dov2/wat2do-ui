-- Migration: create ab_assignments table for sticky A/B variant assignment
-- Created: 2026-04-16
--
-- Problem (audit M2): variant assignment is computed from
--     sha256(experiment_name:user_id)
-- which means any change to ``experiment_name`` (rename, rollout, bug)
-- reshuffles every user into a different variant.  There is no
-- persistent record of "user X was assigned variant Y for experiment Z",
-- so we can't detect or audit the reshuffle.
--
-- Fix: persist the first computed variant per (user_id, experiment_name)
-- and read it back on subsequent requests.  ABTestService.get_user_variant
-- now does a SELECT → (optional) INSERT, making the assignment sticky
-- across deploys and experiment renames.
--
-- Design decisions:
--   * UNIQUE (user_id, experiment_name) enforces one variant per user per
--     experiment.  Concurrent inserts race against this constraint and
--     the losing writer's error is swallowed (the winning row is used).
--   * user_id is uuid and references public.users(id) ON DELETE CASCADE
--     — an assignment for a deleted user is meaningless, matching the
--     CASCADE behaviour of user_recommendations.
--   * experiment_name matches ab_test_events.experiment_name VARCHAR(64).
--   * variant is CHECKed against the known labels so rogue inserts can't
--     create orphan variants that get_ctr_by_variant() would silently
--     drop.
--   * assigned_at is informational only — used for future forensic audits
--     of rollout timing.

CREATE TABLE IF NOT EXISTS ab_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_name VARCHAR(64) NOT NULL,
    variant         VARCHAR(32) NOT NULL,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enforce one assignment per (user, experiment).  Also gives the SELECT
-- lookup an index-backed O(log n) path.
CREATE UNIQUE INDEX IF NOT EXISTS ux_ab_assignments_user_experiment
    ON ab_assignments (user_id, experiment_name);

-- CHECK: variant must be one of the canonical labels used by
-- ABTestService.variants.  Matches ab_test_events CHECK in the sibling
-- migration 20260416007_ab_event_checks.sql.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_ab_assignments_variant'
    ) THEN
        ALTER TABLE ab_assignments
            ADD CONSTRAINT chk_ab_assignments_variant
            CHECK (variant IN ('control', 'treatment'));
    END IF;
END $$;

-- Enable RLS (service-role bypass; blocks direct anon/authenticated
-- access — project-wide policy per CLAUDE.md).
ALTER TABLE ab_assignments ENABLE ROW LEVEL SECURITY;
