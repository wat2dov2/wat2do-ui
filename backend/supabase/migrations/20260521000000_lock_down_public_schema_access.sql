-- Migration: lock_down_public_schema_access
-- Created: 2026-05-21
--
-- The FastAPI backend is the only supported table API and it connects with
-- the Supabase service-role key. Direct anon/authenticated table access should
-- stay blocked even if Supabase default grants drift over time.
--
-- Idempotent: RLS is enabled only for existing known app tables, and REVOKE /
-- GRANT statements are safe to re-run.

BEGIN;

-- Keep RLS explicitly enabled on every repo-owned public table. The backend
-- bypasses RLS with service_role; anon/authenticated clients have no policies.
DO $$
DECLARE
    table_name text;
    table_regclass regclass;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'ab_assignments',
        'ab_test_events',
        'club_integrations',
        'clubs',
        'credit_transactions',
        'event_dates',
        'event_promotions',
        'event_submissions',
        'events',
        'notification_preferences',
        'notifications_log',
        'qr_code_scans',
        'qr_codes',
        'reported_events',
        'scrape_runs',
        'scraped_events',
        'user_credits',
        'user_event_rsvps',
        'user_interactions',
        'user_recommendations',
        'user_saved_events',
        'users'
    ]::text[]
    LOOP
        table_regclass := to_regclass(format('public.%I', table_name));
        IF table_regclass IS NOT NULL THEN
            EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', table_regclass);
        END IF;
    END LOOP;
END $$;

-- RLS blocks row access, but removing grants makes the service-role-only
-- architecture obvious and prevents accidental direct PostgREST exposure.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Preserve the same posture for future tables/functions created by migrations.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;

COMMIT;
