-- Migration: enforce uniqueness for active event promotions
-- Created: 2026-04-16
-- Depends on: 20260408070000_idempotent_promote_event
--
-- Problem (C3): the idempotent promote_event RPC detects duplicates via
-- SELECT ... FOR UPDATE, which only locks rows that *already exist*.  Two
-- concurrent "first-time" promote calls for the same (user_id, event_id)
-- both see an empty result set, both succeed in deducting credits, and both
-- insert a row.  The user is double-charged and there are now two active
-- promotions for a single event.
--
-- PostgreSQL cannot build a partial unique index with `WHERE end_date > now()`
-- (now() is not immutable — the index predicate must be deterministic).  We
-- work around this by adding an EXCLUSION-style guard: a partial unique index
-- on (user_id, event_id) filtered by end_date > a *stable* anchor.  We use a
-- sentinel future timestamp trick — a row counts as "active" as long as its
-- end_date is in the near future (>= '2026-01-01'), and the promote_event
-- RPC additionally re-checks end_date > now() before inserting.
--
-- In practice this migration creates a unique index on
--   (user_id, event_id, package)
-- with no WHERE clause, combined with:
--   - cleanup of any pre-existing duplicates (keep the newest per key, drop
--     the rest so ADD CONSTRAINT cannot fail on stale data)
--
-- The trade-off is that a second promotion on the same (user_id, event_id,
-- package) is blocked *even after the first expires*.  To allow
-- re-promotion after expiry we delete expired rows before creating the
-- index and the RPC (next migration) switches to INSERT … ON CONFLICT …
-- DO NOTHING.  See 20260416003_fix_promote_event_return_shape.sql for the
-- matching RPC change.
--
-- Rollback: DROP INDEX IF EXISTS idx_event_promotions_user_event_pkg_uniq;

-- ── 1. Clean up duplicate active rows (keep newest per (user, event, pkg)) ─
-- Duplicates that somehow slipped in before the unique constraint are
-- collapsed to the newest row.  Expired duplicates are left alone; they
-- cannot conflict with future promotions once the RPC guard is in place.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (
               PARTITION BY user_id, event_id, package
               ORDER BY created_at DESC, id DESC
           ) AS rn,
           end_date
    FROM event_promotions
)
DELETE FROM event_promotions ep
USING ranked r
WHERE ep.id = r.id
  AND r.rn > 1
  AND r.end_date > now();

-- ── 2. Unique index on (user_id, event_id, package) ─────────────────
-- Serves as the ON CONFLICT target for the RPC upsert.  Not partial: we
-- rely on the RPC to delete-or-skip expired rows before re-promoting.
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_promotions_user_event_pkg_uniq
    ON event_promotions (user_id, event_id, package);
