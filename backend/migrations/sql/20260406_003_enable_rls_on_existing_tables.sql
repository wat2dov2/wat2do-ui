-- Migration: enable RLS on all pre-existing tables and drop wide-open policies
-- Created: 2026-04-06
--
-- Previously, some tables had RLS with a "Service role full access" policy
-- that granted USING(true)/CHECK(true) to public — effectively no protection.
-- This migration enables RLS everywhere and removes those permissive policies.
-- The service_role key (used by FastAPI) bypasses RLS by default in Supabase.

-- Drop wide-open policies from tables that had them
DROP POLICY IF EXISTS "Service role full access" ON ab_test_events;
DROP POLICY IF EXISTS "Service role full access" ON user_interactions;
DROP POLICY IF EXISTS "Service role full access" ON user_recommendations;
DROP POLICY IF EXISTS "Service role full access" ON user_saved_events;

-- Enable RLS on tables that previously lacked it
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_code_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
