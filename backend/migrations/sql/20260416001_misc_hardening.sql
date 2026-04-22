-- Migration: misc_hardening
-- Created: 2026-04-16
--
-- Addresses trivial audit findings that each amount to a single CHECK
-- constraint or index:
--
--   D9  — user_recommendations.predicted_score could persist NaN/Inf,
--         breaking JSON serialization downstream.  Also no bound on
--         rank.  Add CHECK constraints to enforce sane values.
--   D13 — user_interactions.metadata JSONB has no DB-layer size cap,
--         even though the API enforces MAX_INTERACTION_METADATA_BYTES =
--         2048.  Any direct SQL / job / seed can bypass the limit.  Add
--         a CHECK on octet_length to mirror the application cap.
--   D23 — idx_users_role is a full index on a near-uniform column.  A
--         partial index on `WHERE role = 'admin'` is much smaller and
--         better suited to the "look up admin users" workload that
--         _check_admin() drives on every admin-route request.  The
--         existing index is kept (DROP would widen the diff) and the
--         new partial index is added alongside.
--
-- Idempotent: guarded by pg_constraint / IF NOT EXISTS.

-- =========================================================================
-- D9: bound predicted_score and rank on user_recommendations
-- =========================================================================

-- Note on NaN detection in PostgreSQL:
--   Unlike IEEE 754, PostgreSQL treats NaN as equal to itself for sort
--   stability, so `x <> x` does NOT detect NaN.  We instead compare
--   directly to the typed literal 'NaN'::float8.  Same treatment for
--   +/-Infinity.  Combined with a `>= 0` floor, this rejects every
--   non-finite or negative score.
--
-- The audit suggests [0, 10] for predicted_score and rank <= 1000;
-- use an open upper bound here to avoid breaking live pipelines whose
-- score-normalization ranges are model-dependent.  The goal is to
-- reject NaN/Inf/negative, not to micromanage scale.

-- First, scrub any offending rows so the CHECK add does not fail.
DELETE FROM user_recommendations
WHERE predicted_score IS NULL
   OR predicted_score = 'NaN'::float8
   OR predicted_score = 'Infinity'::float8
   OR predicted_score = '-Infinity'::float8
   OR predicted_score < 0
   OR rank IS NULL
   OR rank < 1;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_recommendations_score_finite_nonneg'
    ) THEN
        ALTER TABLE user_recommendations
            ADD CONSTRAINT chk_user_recommendations_score_finite_nonneg
            CHECK (
                predicted_score IS NOT NULL
                AND predicted_score <> 'NaN'::float8
                AND predicted_score <> 'Infinity'::float8
                AND predicted_score <> '-Infinity'::float8
                AND predicted_score >= 0
            );
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_recommendations_rank_positive'
    ) THEN
        ALTER TABLE user_recommendations
            ADD CONSTRAINT chk_user_recommendations_rank_positive
            CHECK (rank IS NOT NULL AND rank >= 1);
    END IF;
END $$;

-- =========================================================================
-- D13: cap user_interactions.metadata size to mirror the app-level
--      MAX_INTERACTION_METADATA_BYTES (2048).
-- =========================================================================

-- Scrub any oversized blobs before adding the constraint.  Use
-- octet_length on the JSON text representation (same measurement the
-- application uses).
UPDATE user_interactions
SET metadata = NULL
WHERE metadata IS NOT NULL
  AND octet_length(metadata::text) > 2048;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_interactions_metadata_size'
    ) THEN
        ALTER TABLE user_interactions
            ADD CONSTRAINT chk_user_interactions_metadata_size
            CHECK (
                metadata IS NULL
                OR octet_length(metadata::text) <= 2048
            );
    END IF;
END $$;

-- =========================================================================
-- D23: partial index on users(role) WHERE role = 'admin'
-- =========================================================================
-- Keeps the existing idx_users_role (for backward compatibility with
-- any query that filters on role directly) but adds a much smaller
-- partial index tuned for the "is this user an admin?" lookup used on
-- every admin-route request.
CREATE INDEX IF NOT EXISTS idx_users_admin_partial
    ON users (id)
    WHERE role = 'admin';
