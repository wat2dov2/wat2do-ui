-- Migration: sync_schema_delta
-- Created: 2026-04-21
--
-- One-shot consolidation of 27 previously-unapplied migrations
-- (dated 2026-04-07 through 2026-04-17) that never made it into the
-- production DB. This file brings the DB from its current
-- partially-migrated state up to the intended final schema.
--
-- Future schema changes should go in NEW `supabase/migrations/*.sql`
-- files — do NOT append to this one.
--
-- This migration is fully idempotent: every statement is guarded with
-- IF NOT EXISTS, CREATE OR REPLACE, pg_constraint lookups, or
-- ON CONFLICT DO NOTHING, so it can be re-applied safely.
--
-- Assumed current DB state:
--   * Core tables exist (users, events, clubs, user_interactions,
--     user_saved_events, user_recommendations, ab_test_events,
--     user_credits, event_promotions, event_submissions,
--     reported_events, scraped_events, club_integrations, qr_codes,
--     qr_code_scans).
--   * RLS is enabled on core tables; storage buckets and their
--     policies are already configured — we do NOT touch them.
--   * Zero user-defined functions exist in `public`.
--   * No credit_transactions / ab_assignments tables yet.
--   * No FKs / CHECKs from the pending migrations have been added.
--   * user_credits.balance currently has DEFAULT 100.
--
-- Superseded / skipped source migrations (bodies not re-emitted):
--   * 20260408010000_add_atomic_promote_event.sql       (promote_event v1)
--   * 20260408050000_promote_event_guard_negative_cost  (promote_event v2)
--   * 20260408070000_idempotent_promote_event.sql       (promote_event v3)
--   * 20260416003_fix_promote_event_return_shape.sql    (promote_event v4)
--   All superseded by the ledger-emitting version from
--   20260416003_add_credit_ledger.sql.
--
-- Dependency order (each section depends only on those above it):
--   1.  Value normalization / data cleanup (users.role, statuses,
--       categories, created_by, NaN scores, oversized metadata,
--       invalid Discord JSON).
--   2.  Null-safe orphan cleanup (users / events parents).
--   3.  Drop incorrect auth.users FKs on user_interactions /
--       user_saved_events.
--   4.  Add unique constraint on users.supabase_auth_id (needed as
--       an FK target for events/clubs.created_by).
--   5.  Column shape changes: ab_test_events.experiment_name NOT NULL,
--       user_id / event_id relaxed to NULL for SET NULL FKs.
--   6.  Add all FKs (constraint adds guarded by pg_constraint lookup).
--   7.  Add all CHECK constraints.
--   8.  Create credit_transactions + ab_assignments tables.
--   9.  Create unique index on event_promotions(user_id, event_id,
--       package) — required BEFORE the promote_event function, which
--       uses it as an ON CONFLICT target.
--   10. Create supporting indexes (idx_event_promotions_user_event,
--       ix_user_interactions_user_created, idx_users_admin_partial,
--       ix_scraped_events_source_scraped_at, ix_ab_test_events_experiment,
--       idx_credit_transactions_user_id, ux_ab_assignments_user_experiment).
--   11. Create / replace RPC functions (final versions, pinned
--       search_path, ledger emission).
--   12. Drop DEFAULT on user_credits.balance.
--   13. Clean invalid Discord JSON + re-run club_integrations backfill.
--   14. REVOKE EXECUTE from PUBLIC/anon/authenticated, GRANT to
--       service_role for all final RPCs.

-- ────────────────────────────────────────────────────────────────────
-- 1. Value normalization / data cleanup
-- ────────────────────────────────────────────────────────────────────

-- 1a. users.role — normalize drift to {'user','admin'} (source: 20260416001_users_role_check)
UPDATE users
SET role = CASE
    WHEN lower(btrim(role)) = 'admin' THEN 'admin'
    WHEN lower(btrim(role)) = 'user'  THEN 'user'
    ELSE 'user'
END
WHERE role IS NULL
   OR role NOT IN ('user', 'admin');

-- 1b. event_submissions.status — normalize drift (source: 20260416001_status_category_checks)
UPDATE event_submissions
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'approved', 'rejected');

-- 1c. reported_events.status — normalize drift
UPDATE reported_events
SET status = 'pending'
WHERE status IS NULL
   OR status NOT IN ('pending', 'resolved', 'dismissed');

-- 1d. event_promotions.package — normalize drift
UPDATE event_promotions
SET package = 'featured'
WHERE package IS NULL
   OR package NOT IN ('featured', 'email', 'combo');

-- 1e. events.category — normalize drift to the canonical 22-value set
UPDATE events
SET category = 'Academics'
WHERE category IS NOT NULL
  AND category NOT IN (
      'Academics','Studying','Career','Networking','Games','Partying',
      'Athletics','Art','Dance','Culture','Religion','Advocacy',
      'Technology','Design','Entrepreneurship','Health','Wellness',
      'Mental Health','Music','Sports','Food','Volunteering'
  );

-- 1f. events.created_by — normalize non-UUID strings to NULL (source: 20260416001_owner_fks)
UPDATE events
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 1g. clubs.created_by — normalize non-UUID strings to NULL
UPDATE clubs
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 1h. qr_codes.created_by — NOT NULL, so delete rows with non-UUID values
DELETE FROM qr_codes
WHERE created_by IS NULL
   OR created_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- 1i. user_recommendations — scrub NaN/Inf/negative scores and bad ranks
--     (source: 20260416001_misc_hardening)
DELETE FROM user_recommendations
WHERE predicted_score IS NULL
   OR predicted_score = 'NaN'::float8
   OR predicted_score = 'Infinity'::float8
   OR predicted_score = '-Infinity'::float8
   OR predicted_score < 0
   OR rank IS NULL
   OR rank < 1;

-- 1j. user_interactions — cap metadata size (mirrors app-level limit)
UPDATE user_interactions
SET metadata = NULL
WHERE metadata IS NOT NULL
  AND octet_length(metadata::text) > 2048;

-- 1k. ab_test_events.experiment_name — add column + backfill
--     (source: 20260408030000_add_ab_test_ctr_rpc)
ALTER TABLE ab_test_events ADD COLUMN IF NOT EXISTS experiment_name VARCHAR(64);
UPDATE ab_test_events SET experiment_name = 'recommendations_v1' WHERE experiment_name IS NULL;
ALTER TABLE ab_test_events ALTER COLUMN experiment_name SET NOT NULL;

-- 1l. scraped_events.event_id — null out orphaned references when the
--     retired table exists in older databases.
DO $$
BEGIN
    IF to_regclass('public.scraped_events') IS NOT NULL THEN
        UPDATE scraped_events
           SET event_id = NULL
         WHERE event_id IS NOT NULL
           AND event_id NOT IN (SELECT id FROM events);
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 2. Null-safe orphan cleanup (users / events parents)
--    Run before any FK add. Uses NOT EXISTS (not NOT IN) so a NULL
--    parent.id cannot produce a silent no-op.
--    Consolidates: 20260409031953, 20260409033624, 20260409033636,
--                  20260416001_fix_orphan_cleanup, 20260416001_recheck_orphans.
-- ────────────────────────────────────────────────────────────────────

-- 2a. user_credits orphans
DELETE FROM user_credits uc
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = uc.user_id);

-- 2b. event_promotions orphans
DELETE FROM event_promotions ep
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ep.user_id);

DELETE FROM event_promotions ep
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ep.event_id);

-- 2c. user_recommendations orphans
DELETE FROM user_recommendations ur
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ur.user_id);

DELETE FROM user_recommendations ur
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ur.event_id);

-- 2d. ab_test_events orphans (columns will be made nullable below)
DELETE FROM ab_test_events ate
WHERE ate.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ate.user_id);

DELETE FROM ab_test_events ate
WHERE ate.event_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ate.event_id);

-- 2e. user_interactions orphans (user_id will become nullable via FK)
DELETE FROM user_interactions ui
WHERE ui.user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ui.user_id);

DELETE FROM user_interactions ui
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = ui.event_id);

-- 2f. user_saved_events orphans
DELETE FROM user_saved_events se
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = se.user_id);

DELETE FROM user_saved_events se
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = se.event_id);

-- 2g. reported_events orphans (source: 20260416005_add_fks_to_reports_and_submissions)
DELETE FROM reported_events
WHERE NOT EXISTS (SELECT 1 FROM events e WHERE e.id = reported_events.event_id);

DELETE FROM reported_events
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = reported_events.user_id);

-- 2h. event_submissions orphans
DELETE FROM event_submissions
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = event_submissions.user_id);

-- ────────────────────────────────────────────────────────────────────
-- 3. Drop incorrect auth.users FKs
--    The originals pointed at auth.users; the app uses public.users.id.
--    (source: 20260409033636_fix_interaction_fks_to_public_users)
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_interactions_user_id_fkey'
    ) THEN
        ALTER TABLE user_interactions
            DROP CONSTRAINT user_interactions_user_id_fkey;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'user_saved_events_user_id_fkey'
    ) THEN
        ALTER TABLE user_saved_events
            DROP CONSTRAINT user_saved_events_user_id_fkey;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 4. Unique constraint on users.supabase_auth_id
--    Required as an FK target for events.created_by / clubs.created_by.
--    (source: 20260416005_add_owner_fks)
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'uq_users_supabase_auth_id'
    ) THEN
        IF NOT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'users'
              AND indexname IN ('users_supabase_auth_id_key', 'uq_users_supabase_auth_id')
        ) THEN
            ALTER TABLE users
                ADD CONSTRAINT uq_users_supabase_auth_id UNIQUE (supabase_auth_id);
        END IF;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 5. Column shape changes
--    ab_test_events.{user_id,event_id}: relax to NULL so ON DELETE
--    SET NULL FKs below can be applied.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE ab_test_events
    ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE ab_test_events
    ALTER COLUMN event_id DROP NOT NULL;

-- Orphan cleanup before events.created_by FK (source: 20260416005_add_owner_fks)
UPDATE events
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT supabase_auth_id FROM users);

UPDATE clubs
SET created_by = NULL
WHERE created_by IS NOT NULL
  AND created_by NOT IN (SELECT supabase_auth_id FROM users);

-- ────────────────────────────────────────────────────────────────────
-- 6. Foreign keys
--    All ADDs are guarded by pg_constraint existence checks.
-- ────────────────────────────────────────────────────────────────────

-- 6a. user_credits.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_credits_user_id'
    ) THEN
        ALTER TABLE user_credits
            ADD CONSTRAINT fk_user_credits_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6b. event_promotions.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_promotions_user_id'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT fk_event_promotions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6c. event_promotions.event_id → events(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_event_promotions_event_id'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT fk_event_promotions_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6d. user_recommendations.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_recommendations_user_id'
    ) THEN
        ALTER TABLE user_recommendations
            ADD CONSTRAINT fk_user_recommendations_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6e. user_recommendations.event_id → events(id) ON DELETE CASCADE
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

-- 6f. ab_test_events.user_id → users(id) ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_ab_test_events_user_id'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT fk_ab_test_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6g. ab_test_events.event_id → events(id) ON DELETE SET NULL
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

-- 6h. user_interactions.event_id → events(id) ON DELETE CASCADE
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

-- 6i. user_interactions.user_id → users(id) ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_interactions_user_id'
    ) THEN
        ALTER TABLE user_interactions
            ADD CONSTRAINT fk_user_interactions_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6j. user_saved_events.event_id → events(id) ON DELETE CASCADE
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

-- 6k. user_saved_events.user_id → users(id) ON DELETE CASCADE
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_user_saved_events_user_id'
    ) THEN
        ALTER TABLE user_saved_events
            ADD CONSTRAINT fk_user_saved_events_user_id
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 6l. reported_events.event_id → events(id) ON DELETE CASCADE
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

-- 6m. reported_events.user_id → users(id) ON DELETE CASCADE
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

-- 6n. event_submissions.user_id → users(id) ON DELETE CASCADE
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

-- 6o. events.created_by → users(supabase_auth_id) ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_events_created_by'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT fk_events_created_by
            FOREIGN KEY (created_by) REFERENCES users(supabase_auth_id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6p. clubs.created_by → users(supabase_auth_id) ON DELETE SET NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_clubs_created_by'
    ) THEN
        ALTER TABLE clubs
            ADD CONSTRAINT fk_clubs_created_by
            FOREIGN KEY (created_by) REFERENCES users(supabase_auth_id) ON DELETE SET NULL;
    END IF;
END $$;

-- 6q. scraped_events.event_id → events(id) ON DELETE SET NULL
DO $$
BEGIN
    IF to_regclass('public.scraped_events') IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_scraped_events_event_id'
    ) THEN
        ALTER TABLE scraped_events
            ADD CONSTRAINT fk_scraped_events_event_id
            FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 7. CHECK constraints
-- ────────────────────────────────────────────────────────────────────

-- 7a. users.role — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_users_role_valid'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT chk_users_role_valid
            CHECK (role IN ('user', 'admin'));
    END IF;
END $$;

-- 7b. user_credits.balance >= 0
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_user_credits_balance_non_negative'
    ) THEN
        ALTER TABLE user_credits
            ADD CONSTRAINT chk_user_credits_balance_non_negative
            CHECK (balance >= 0);
    END IF;
END $$;

-- 7c. event_promotions.credits_spent >= 0
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_credits_non_negative'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_credits_non_negative
            CHECK (credits_spent >= 0);
    END IF;
END $$;

-- 7d. event_promotions.end_date > start_date
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_date_range'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_date_range
            CHECK (end_date > start_date);
    END IF;
END $$;

-- 7e. event_promotions.package — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_promotions_package_valid'
    ) THEN
        ALTER TABLE event_promotions
            ADD CONSTRAINT chk_event_promotions_package_valid
            CHECK (package IN ('featured', 'email', 'combo'));
    END IF;
END $$;

-- 7f. event_submissions.status — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_event_submissions_status_valid'
    ) THEN
        ALTER TABLE event_submissions
            ADD CONSTRAINT chk_event_submissions_status_valid
            CHECK (status IN ('pending', 'approved', 'rejected'));
    END IF;
END $$;

-- 7g. reported_events.status — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_reported_events_status_valid'
    ) THEN
        ALTER TABLE reported_events
            ADD CONSTRAINT chk_reported_events_status_valid
            CHECK (status IN ('pending', 'resolved', 'dismissed'));
    END IF;
END $$;

-- 7h. events.category — canonical 22-value set or NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_events_category_valid'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT chk_events_category_valid
            CHECK (
                category IS NULL
                OR category IN (
                    'Academics','Studying','Career','Networking','Games','Partying',
                    'Athletics','Art','Dance','Culture','Religion','Advocacy',
                    'Technology','Design','Entrepreneurship','Health','Wellness',
                    'Mental Health','Music','Sports','Food','Volunteering'
                )
            );
    END IF;
END $$;

-- 7i. events.created_by — UUID format or NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_events_created_by_uuid_format'
    ) THEN
        ALTER TABLE events
            ADD CONSTRAINT chk_events_created_by_uuid_format
            CHECK (
                created_by IS NULL
                OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;

-- 7j. clubs.created_by — UUID format or NULL
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_clubs_created_by_uuid_format'
    ) THEN
        ALTER TABLE clubs
            ADD CONSTRAINT chk_clubs_created_by_uuid_format
            CHECK (
                created_by IS NULL
                OR created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;

-- 7k. qr_codes.created_by — UUID format (NOT NULL)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_qr_codes_created_by_uuid_format'
    ) THEN
        ALTER TABLE qr_codes
            ADD CONSTRAINT chk_qr_codes_created_by_uuid_format
            CHECK (
                created_by ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            );
    END IF;
END $$;

-- 7l. user_recommendations.predicted_score — finite and non-negative
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

-- 7m. user_recommendations.rank >= 1
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

-- 7n. user_interactions.metadata — size cap
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

-- 7o. ab_test_events.variant — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_ab_test_events_variant'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT chk_ab_test_events_variant
            CHECK (variant IN ('control', 'treatment'));
    END IF;
END $$;

-- 7p. ab_test_events.event_type — canonical set
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'chk_ab_test_events_event_type'
    ) THEN
        ALTER TABLE ab_test_events
            ADD CONSTRAINT chk_ab_test_events_event_type
            CHECK (event_type IN ('impression', 'click'));
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 8. New tables: credit_transactions, ab_assignments
-- ────────────────────────────────────────────────────────────────────

-- 8a. credit_transactions (source: 20260416003_add_credit_ledger)
CREATE TABLE IF NOT EXISTS credit_transactions (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID NOT NULL,
    delta          INTEGER NOT NULL,
    balance_after  INTEGER NOT NULL,
    kind           VARCHAR(32) NOT NULL,
    reason_id      UUID,
    metadata       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_credit_txn_kind
        CHECK (kind IN ('adjust', 'promote', 'refund'))
);

ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;

-- 8b. ab_assignments (source: 20260416007_create_ab_assignments)
CREATE TABLE IF NOT EXISTS ab_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    experiment_name VARCHAR(64) NOT NULL,
    variant         VARCHAR(32) NOT NULL,
    assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

ALTER TABLE ab_assignments ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────
-- 9. Unique index on event_promotions(user_id, event_id, package)
--    Required BEFORE promote_event is created (ON CONFLICT target).
--    (source: 20260416003_unique_active_promotions)
-- ────────────────────────────────────────────────────────────────────

-- Collapse any pre-existing active duplicates to the newest row so the
-- CREATE UNIQUE INDEX cannot fail.
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_event_promotions_user_event_pkg_uniq
    ON event_promotions (user_id, event_id, package);

-- ────────────────────────────────────────────────────────────────────
-- 10. Supporting indexes
-- ────────────────────────────────────────────────────────────────────

-- 10a. Fast active-promotion lookup
CREATE INDEX IF NOT EXISTS idx_event_promotions_user_event
    ON event_promotions (user_id, event_id);

-- 10b. Hot path: user_interactions filtered by user_id + created_at DESC
CREATE INDEX IF NOT EXISTS ix_user_interactions_user_created
    ON user_interactions (user_id, created_at DESC);

-- 10c. Partial index on users for admin-role lookups
CREATE INDEX IF NOT EXISTS idx_users_admin_partial
    ON users (id)
    WHERE role = 'admin';

-- 10d. Retired scraped-events admin list default ordering
DO $$
BEGIN
    IF to_regclass('public.scraped_events') IS NOT NULL THEN
        EXECUTE 'CREATE INDEX IF NOT EXISTS ix_scraped_events_source_scraped_at ON scraped_events (source, scraped_at DESC)';
    END IF;
END $$;

-- 10e. get_ab_test_ctr hot path
CREATE INDEX IF NOT EXISTS ix_ab_test_events_experiment
    ON ab_test_events (experiment_name, variant, event_type);

-- 10f. credit_transactions by user (newest first)
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_id
    ON credit_transactions (user_id, created_at DESC);

-- 10g. ab_assignments — enforce one variant per (user, experiment)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ab_assignments_user_experiment
    ON ab_assignments (user_id, experiment_name);

-- ────────────────────────────────────────────────────────────────────
-- 11. RPC functions — FINAL versions only
--     Bodies are copied verbatim from source files:
--       - ensure_user_credits: 20260407020000 + search_path from 20260408060000
--       - adjust_credits:      20260416003_add_credit_ledger (ledger-emitting)
--       - promote_event:       20260416003_add_credit_ledger (ledger-emitting)
--       - get_ab_test_ctr:     20260408060000 (with SET search_path = public)
-- ────────────────────────────────────────────────────────────────────

-- DROP older promote_event signatures before CREATE OR REPLACE — Postgres
-- refuses to change an existing function's return type. A partial prior
-- push may have created the 4-col version; drop any signature match.
DROP FUNCTION IF EXISTS promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER);

-- 11a. ensure_user_credits — get-or-create a user_credits row
CREATE OR REPLACE FUNCTION ensure_user_credits(p_user_id UUID, p_default_balance INTEGER DEFAULT 100)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT balance INTO v_balance
    FROM user_credits
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        INSERT INTO user_credits (user_id, balance)
        VALUES (p_user_id, p_default_balance)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING balance INTO v_balance;

        -- If the INSERT hit a conflict (concurrent insert), read the existing row.
        IF v_balance IS NULL THEN
            SELECT balance INTO v_balance
            FROM user_credits
            WHERE user_id = p_user_id;
        END IF;
    END IF;

    RETURN v_balance;
END;
$$;

-- 11b. adjust_credits — ledger-emitting version
CREATE OR REPLACE FUNCTION adjust_credits(
    p_user_id         UUID,
    p_amount          INTEGER,
    p_default_balance INTEGER DEFAULT 100
)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    IF p_amount >= 0 THEN
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
        RETURNING balance INTO v_new_balance;
    ELSE
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
          AND user_credits.balance >= -p_amount
        RETURNING balance INTO v_new_balance;

        IF v_new_balance IS NULL THEN
            RETURN -1;
        END IF;
    END IF;

    INSERT INTO credit_transactions (user_id, delta, balance_after, kind)
    VALUES (p_user_id, p_amount, v_new_balance, 'adjust');

    RETURN v_new_balance;
END;
$$;

-- 11c. promote_event — ledger-emitting, idempotent, refund-on-conflict
CREATE OR REPLACE FUNCTION promote_event(
    p_user_id       UUID,
    p_event_id      INTEGER,
    p_package        VARCHAR(32),
    p_credits_cost   INTEGER,
    p_duration_days  INTEGER,
    p_default_balance INTEGER DEFAULT 100
)
RETURNS TABLE (
    promotion_id    UUID,
    user_id         UUID,
    event_id        INTEGER,
    package         VARCHAR(32),
    credits_spent   INTEGER,
    new_balance     INTEGER,
    start_date      TIMESTAMPTZ,
    end_date        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ
)
LANGUAGE plpgsql
SET search_path = public
AS $$
#variable_conflict use_column
-- RETURNS TABLE OUT params (user_id, event_id, package, ...) collide with
-- event_promotions column names, so we tell plpgsql to resolve bare
-- identifiers to columns inside SQL statements. Explicitly-qualified refs
-- (v_existing.*, p_*) are unaffected.
DECLARE
    v_existing        RECORD;
    v_new_balance     INTEGER;
    v_promo_id        UUID;
    v_start           TIMESTAMPTZ;
    v_end             TIMESTAMPTZ;
    v_current_balance INTEGER;
BEGIN
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM event_promotions ep
    WHERE ep.user_id = p_user_id
      AND ep.event_id = p_event_id
      AND ep.package = p_package
      AND ep.end_date <= now();

    SELECT ep.id, ep.user_id, ep.event_id, ep.package, ep.credits_spent,
           ep.start_date, ep.end_date, ep.created_at
    INTO v_existing
    FROM event_promotions ep
    WHERE ep.user_id  = p_user_id
      AND ep.event_id = p_event_id
      AND ep.package  = p_package
      AND ep.end_date > now()
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_existing.user_id,
                   v_existing.event_id,
                   v_existing.package,
                   v_existing.credits_spent,
                   v_current_balance,
                   v_existing.start_date,
                   v_existing.end_date,
                   v_existing.created_at;
        RETURN;
    END IF;

    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    UPDATE user_credits
    SET balance = balance - p_credits_cost,
        updated_at = now()
    WHERE user_credits.user_id = p_user_id
      AND user_credits.balance >= p_credits_cost
    RETURNING balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
        RAISE EXCEPTION 'insufficient_credits'
            USING ERRCODE = 'P0001';
    END IF;

    v_promo_id := gen_random_uuid();
    v_start    := now();
    v_end      := now() + (p_duration_days || ' days')::INTERVAL;

    INSERT INTO event_promotions (id, user_id, event_id, package, credits_spent, start_date, end_date)
    VALUES (v_promo_id, p_user_id, p_event_id, p_package, p_credits_cost, v_start, v_end)
    ON CONFLICT (user_id, event_id, package) DO NOTHING
    RETURNING id, start_date, end_date, created_at
    INTO v_existing;

    IF v_existing.id IS NULL THEN
        -- Lost the race: refund and return the winner's row.
        UPDATE user_credits
        SET balance = balance + p_credits_cost,
            updated_at = now()
        WHERE user_credits.user_id = p_user_id
        RETURNING balance INTO v_new_balance;

        INSERT INTO credit_transactions (user_id, delta, balance_after, kind, reason_id, metadata)
        VALUES (
            p_user_id,
            p_credits_cost,
            COALESCE(v_new_balance, 0),
            'refund',
            NULL,
            jsonb_build_object('event_id', p_event_id, 'package', p_package, 'cause', 'conflict')
        );

        SELECT ep.id, ep.user_id, ep.event_id, ep.package, ep.credits_spent,
               ep.start_date, ep.end_date, ep.created_at
        INTO v_existing
        FROM event_promotions ep
        WHERE ep.user_id  = p_user_id
          AND ep.event_id = p_event_id
          AND ep.package  = p_package
          AND ep.end_date > now()
        LIMIT 1;

        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_existing.user_id,
                   v_existing.event_id,
                   v_existing.package,
                   v_existing.credits_spent,
                   v_current_balance,
                   v_existing.start_date,
                   v_existing.end_date,
                   v_existing.created_at;
        RETURN;
    END IF;

    INSERT INTO credit_transactions (user_id, delta, balance_after, kind, reason_id, metadata)
    VALUES (
        p_user_id,
        -p_credits_cost,
        v_new_balance,
        'promote',
        v_promo_id,
        jsonb_build_object('event_id', p_event_id, 'package', p_package)
    );

    RETURN QUERY
        SELECT v_promo_id,
               p_user_id,
               p_event_id,
               p_package,
               p_credits_cost,
               v_new_balance,
               v_start,
               v_end,
               v_start;
END;
$$;

-- 11d. get_ab_test_ctr — server-side CTR aggregation
CREATE OR REPLACE FUNCTION get_ab_test_ctr(p_experiment_name VARCHAR)
RETURNS TABLE (
    variant     VARCHAR,
    impressions BIGINT,
    clicks      BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
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

-- ────────────────────────────────────────────────────────────────────
-- 12. Drop DEFAULT from user_credits.balance
--     (source: 20260417000001_drop_user_credits_default)
-- ────────────────────────────────────────────────────────────────────

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        WHERE c.relname = 'user_credits'
          AND a.attname = 'balance'
          AND a.atthasdef
    ) THEN
        ALTER TABLE user_credits ALTER COLUMN balance DROP DEFAULT;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────
-- 13. Clean invalid Discord JSON + re-run club_integrations backfill
--     (source: 20260417000002_clean_invalid_discord_json)
-- ────────────────────────────────────────────────────────────────────

-- 13a. NULL out unparseable JSON-shaped discord values (per-row try/catch
--      so one bad cast cannot abort the whole statement).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, discord
        FROM clubs
        WHERE discord IS NOT NULL
          AND discord LIKE '{%'
    LOOP
        BEGIN
            PERFORM r.discord::jsonb;
        EXCEPTION
            WHEN invalid_text_representation OR others THEN
                UPDATE clubs SET discord = NULL WHERE id = r.id;
        END;
    END LOOP;
END $$;

-- 13b. Format 3: _integrations envelope
INSERT INTO club_integrations (club_id, platform, connected, name, last_sync,
    server_id, server_name, channel_id, channel_name,
    handle, group_id, group_name, page_id, page_name, connection_type)
SELECT
    c.id,
    kv.key AS platform,
    COALESCE((kv.value->>'connected')::boolean, false),
    kv.value->>'name',
    CASE WHEN kv.value->>'last_sync' IS NOT NULL
         THEN (kv.value->>'last_sync')::timestamptz
         ELSE NULL END,
    COALESCE(kv.value->'metadata'->>'server_id', kv.value->'metadata'->>'workspace_id'),
    COALESCE(kv.value->'metadata'->>'server_name', kv.value->'metadata'->>'workspace_name'),
    kv.value->'metadata'->>'channel_id',
    kv.value->'metadata'->>'channel_name',
    kv.value->'metadata'->>'handle',
    kv.value->'metadata'->>'group_id',
    kv.value->'metadata'->>'group_name',
    kv.value->'metadata'->>'page_id',
    kv.value->'metadata'->>'page_name',
    kv.value->'metadata'->>'connection_type'
FROM clubs c,
     LATERAL jsonb_each((c.discord::jsonb)->'_integrations') AS kv(key, value)
WHERE c.discord IS NOT NULL
  AND c.discord LIKE '{%'
  AND (c.discord::jsonb) ? '_integrations'
ON CONFLICT (club_id, platform) DO NOTHING;

-- 13c. Format 2: Discord-only JSON
INSERT INTO club_integrations (club_id, platform, connected, name, last_sync,
    server_id, server_name, channel_id, channel_name)
SELECT
    c.id,
    'discord',
    COALESCE((c.discord::jsonb->>'connected')::boolean, true),
    c.discord::jsonb->>'name',
    CASE WHEN c.discord::jsonb->>'last_sync' IS NOT NULL
         THEN (c.discord::jsonb->>'last_sync')::timestamptz
         ELSE NULL END,
    c.discord::jsonb->>'server_id',
    c.discord::jsonb->>'server_name',
    c.discord::jsonb->>'channel_id',
    c.discord::jsonb->>'channel_name'
FROM clubs c
WHERE c.discord IS NOT NULL
  AND c.discord LIKE '{%'
  AND NOT ((c.discord::jsonb) ? '_integrations')
ON CONFLICT (club_id, platform) DO NOTHING;

-- 13d. Format 1: Plain string (legacy discord handle/link)
INSERT INTO club_integrations (club_id, platform, connected, name)
SELECT
    c.id,
    'discord',
    true,
    c.discord
FROM clubs c
WHERE c.discord IS NOT NULL
  AND c.discord != ''
  AND NOT (c.discord LIKE '{%')
ON CONFLICT (club_id, platform) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────
-- 14. REVOKE / GRANT — lock down all RPC functions to service_role only
--     Merges 20260408020000_revoke_rpc_execute_from_public and the
--     REVOKE/GRANT tail of 20260408030000_add_ab_test_ctr_rpc.
-- ────────────────────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.ensure_user_credits(UUID, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.adjust_credits(UUID, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM anon;
REVOKE EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.promote_event(UUID, INTEGER, VARCHAR, INTEGER, INTEGER, INTEGER) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.get_ab_test_ctr(VARCHAR) TO service_role;

-- ────────────────────────────────────────────────────────────────────
-- 15. Drop legacy migration-tracking tables
--     `alembic_version` (from Alembic) and `public.schema_migrations`
--     (from the old custom scripts/migrate.py runner) are superseded
--     by `supabase_migrations.schema_migrations` — delete them.
-- ────────────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS public.alembic_version;
DROP TABLE IF EXISTS public.schema_migrations;
