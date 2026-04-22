-- Migration: fix_orphan_cleanup
-- Created: 2026-04-16
--
-- Fixes audit finding D12: previous cleanup migrations used
-- `WHERE x NOT IN (SELECT id FROM parent)` which is null-unsafe —
-- `x NOT IN (NULL, ...)` evaluates to NULL (three-valued logic), so if
-- a parent row has an unexpectedly-NULL id the DELETE silently becomes
-- a no-op and orphan rows survive into the ADD CONSTRAINT step.
--
-- Affected migrations used the NOT IN pattern in these cleanups:
--   * 20260409031953_add_missing_fks_and_checks.sql    (lines 57-58, 91-95, 154-155, 176-177)
--   * 20260409033624_add_missing_event_id_fks.sql       (lines 46-47, 67-68, 87-88, 108-110)
--   * 20260409033636_fix_interaction_fks_to_public_users.sql (lines 50-52, 83-85)
--
-- Although users.id and events.id are PKs (non-nullable in practice),
-- the pattern is fragile.  This migration re-runs all of those cleanups
-- using the null-safe `NOT EXISTS (SELECT 1 FROM ... WHERE ...)` form.
-- Any rows that became orphans between those migrations and now (e.g.
-- through manual SQL in production, or a race with the ADD CONSTRAINT
-- step per D22) are swept up here.
--
-- This migration is purely additive / cleanup: it does not add new
-- constraints.  If the earlier FKs are already in place the DELETEs
-- simply find nothing to remove.
--
-- Safe to re-run (idempotent — a no-op after the first run unless new
-- orphans appear).

-- =========================================================================
-- 1. user_credits.user_id orphans
-- =========================================================================
DELETE FROM user_credits uc
WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = uc.user_id
);

-- =========================================================================
-- 2. event_promotions.user_id / event_id orphans
-- =========================================================================
DELETE FROM event_promotions ep
WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = ep.user_id
);

DELETE FROM event_promotions ep
WHERE NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = ep.event_id
);

-- =========================================================================
-- 3. user_recommendations.user_id / event_id orphans
-- =========================================================================
DELETE FROM user_recommendations ur
WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = ur.user_id
);

DELETE FROM user_recommendations ur
WHERE NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = ur.event_id
);

-- =========================================================================
-- 4. ab_test_events.user_id / event_id orphans
-- =========================================================================
-- These columns are nullable (ON DELETE SET NULL targets).  Only remove
-- rows where the id is non-null but points nowhere.
DELETE FROM ab_test_events ate
WHERE ate.user_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = ate.user_id
  );

DELETE FROM ab_test_events ate
WHERE ate.event_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM events e WHERE e.id = ate.event_id
  );

-- =========================================================================
-- 5. user_interactions.user_id / event_id orphans
-- =========================================================================
DELETE FROM user_interactions ui
WHERE ui.user_id IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM users u WHERE u.id = ui.user_id
  );

DELETE FROM user_interactions ui
WHERE NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = ui.event_id
);

-- =========================================================================
-- 6. user_saved_events.user_id / event_id orphans
-- =========================================================================
DELETE FROM user_saved_events se
WHERE NOT EXISTS (
    SELECT 1 FROM users u WHERE u.id = se.user_id
);

DELETE FROM user_saved_events se
WHERE NOT EXISTS (
    SELECT 1 FROM events e WHERE e.id = se.event_id
);
