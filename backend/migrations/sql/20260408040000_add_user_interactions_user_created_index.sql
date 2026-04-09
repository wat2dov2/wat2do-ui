-- Migration: add composite index on user_interactions(user_id, created_at DESC)
-- Created: 2026-04-08
--
-- Several hot paths filter user_interactions by user_id (equality) and
-- created_at (range / sort):
--   - check_duplicate_interactions: eq(user_id) + gte(created_at)
--   - _fetch_recent_actions:        eq(user_id) + gt(created_at)
--   - get_user_event_scores:        eq(user_id) + order(created_at)
--
-- Existing indexes cover (user_id, event_id) and (created_at) separately,
-- but none covers the compound (user_id, created_at) filter.  Without it
-- Postgres must index-scan on user_id then sort/filter created_at in-heap,
-- or do a full created_at index scan filtering user_id afterward.
--
-- The DESC ordering on created_at benefits the most common access pattern
-- (recent interactions first).

CREATE INDEX IF NOT EXISTS ix_user_interactions_user_created
    ON user_interactions (user_id, created_at DESC);
