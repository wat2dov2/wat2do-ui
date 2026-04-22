-- Migration: recheck_orphans
-- Created: 2026-04-16
--
-- Documents and mitigates audit finding D22: the orphan-cleanup + FK
-- ADD pattern in 20260409031953_add_missing_fks_and_checks.sql runs the
-- DELETE and the ADD CONSTRAINT without a table-level lock between
-- them, so a concurrent write during the migration could insert a new
-- orphan AFTER the DELETE but BEFORE the ADD CONSTRAINT, causing the
-- migration to abort with an FK violation.
--
-- Proper fix (not done here because we cannot edit historical
-- migrations):
--   * Use `ALTER TABLE ... ADD CONSTRAINT ... NOT VALID` followed by
--     `VALIDATE CONSTRAINT` to avoid a table-level lock window.
--   * Or wrap the cleanup + ADD inside a single BEGIN; LOCK TABLE users
--     IN SHARE MODE; ...; COMMIT; block.
--
-- Mitigation here: re-scan for orphan rows that may have crept in since
-- the earlier migrations ran (either via the D22 race, or via direct
-- DB edits that bypassed FKs prior to their addition).  If no FK
-- existed when the orphan was created, it would still be in the table.
-- This migration cleans up any such stragglers.
--
-- Uses the null-safe NOT EXISTS form (see also
-- 20260416001_fix_orphan_cleanup.sql for D12) so it cannot silently
-- no-op if any id happens to be NULL.
--
-- Idempotent: DELETEs find nothing to remove after the first run.

-- =========================================================================
-- 1. ab_test_events: user_id / event_id
-- =========================================================================
-- Both columns are nullable (ON DELETE SET NULL targets).  Only clean
-- rows where the id is set but points nowhere.
DELETE FROM ab_test_events ate
WHERE ate.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ate.user_id);

DELETE FROM ab_test_events ate
WHERE ate.event_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ate.event_id);

-- =========================================================================
-- 2. user_credits.user_id
-- =========================================================================
DELETE FROM user_credits uc
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = uc.user_id);

-- =========================================================================
-- 3. event_promotions.user_id / event_id
-- =========================================================================
DELETE FROM event_promotions ep
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id);

DELETE FROM event_promotions ep
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ep.event_id);

-- =========================================================================
-- 4. user_recommendations.user_id / event_id
-- =========================================================================
DELETE FROM user_recommendations ur
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ur.user_id);

DELETE FROM user_recommendations ur
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ur.event_id);

-- =========================================================================
-- 5. user_interactions.user_id / event_id
-- =========================================================================
-- user_id is nullable (ON DELETE SET NULL); event_id is NOT NULL.
DELETE FROM user_interactions ui
WHERE ui.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ui.user_id);

DELETE FROM user_interactions ui
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ui.event_id);

-- =========================================================================
-- 6. user_saved_events.user_id / event_id
-- =========================================================================
DELETE FROM user_saved_events se
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = se.user_id);

DELETE FROM user_saved_events se
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = se.event_id);
