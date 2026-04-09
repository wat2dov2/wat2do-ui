-- Migration: add experiment_name column and server-side CTR aggregation
-- Created: 2026-04-08
--
-- Fixes two issues in get_ctr_by_variant:
--
-- 1. Missing experiment_name column — the ab_test_events table had no way
--    to distinguish experiments.  All rows were implicitly for a single
--    experiment, but adding a second experiment would silently mix data.
--    This adds the column, backfills existing rows with 'recommendations_v1',
--    and makes it NOT NULL going forward.
--
-- 2. Client-side pagination — the Python service fetched ALL rows in 1000-row
--    pages to count variants in memory.  At scale (e.g. 1M+ rows) this means
--    1000+ sequential HTTP round-trips.  The new RPC function computes the
--    GROUP BY aggregation in a single database query.

-- ── Step 1: add experiment_name column (nullable first for backfill) ─────
ALTER TABLE ab_test_events ADD COLUMN IF NOT EXISTS experiment_name VARCHAR(64);

-- Backfill existing rows — all current data belongs to 'recommendations_v1'.
UPDATE ab_test_events SET experiment_name = 'recommendations_v1' WHERE experiment_name IS NULL;

-- Now make it NOT NULL.
ALTER TABLE ab_test_events ALTER COLUMN experiment_name SET NOT NULL;

-- Index for the RPC query: filter by experiment_name, group by variant+event_type.
CREATE INDEX IF NOT EXISTS ix_ab_test_events_experiment
    ON ab_test_events (experiment_name, variant, event_type);

-- ── Step 2: server-side CTR aggregation function ─────────────────────────
CREATE OR REPLACE FUNCTION get_ab_test_ctr(p_experiment_name VARCHAR)
RETURNS TABLE (
    variant     VARCHAR,
    impressions BIGINT,
    clicks      BIGINT
)
LANGUAGE sql
STABLE
AS $$
    SELECT
        a.variant,
        COUNT(*) FILTER (WHERE a.event_type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE a.event_type = 'click')      AS clicks
    FROM ab_test_events a
    WHERE a.experiment_name = p_experiment_name
    GROUP BY a.variant
    ORDER BY a.variant;
$$;

-- ── Step 3: lock down permissions ────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) TO service_role;
