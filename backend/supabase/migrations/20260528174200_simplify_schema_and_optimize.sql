-- Migration: simplify_schema_and_optimize
-- Created: 2026-05-28
--
-- Performance & Schema Simplification migration:
--   1. Drop public.events_listing view if it still exists.
--   2. Drop the Django-legacy duplicate constraint event_dates_event_id_c0ceb39b_fk_events_id on event_dates,
--      resolving PostgREST's join/embed ambiguity.
--   3. Drop 5 unused social handle columns on events (discord_handle, x_handle, tiktok_handle, fb_handle, other_handle).
--   4. Drop 22 unused legacy/Django tables.
--   5. Add missing B-tree indexes to events table columns used in filtering (school, category, club_type, status).

BEGIN;

-- 1. Drop public.events_listing view if it exists
DROP VIEW IF EXISTS public.events_listing CASCADE;

-- 2. Drop duplicate foreign key constraint on event_dates
ALTER TABLE public.event_dates DROP CONSTRAINT IF EXISTS event_dates_event_id_c0ceb39b_fk_events_id;

-- 3. Drop unused social handle columns on events
ALTER TABLE public.events
    DROP COLUMN IF EXISTS discord_handle,
    DROP COLUMN IF EXISTS x_handle,
    DROP COLUMN IF EXISTS tiktok_handle,
    DROP COLUMN IF EXISTS fb_handle,
    DROP COLUMN IF EXISTS other_handle;

-- 4. Drop unused legacy Django tables
DROP TABLE IF EXISTS public.django_session CASCADE;
DROP TABLE IF EXISTS public.django_migrations CASCADE;
DROP TABLE IF EXISTS public.django_content_type CASCADE;
DROP TABLE IF EXISTS public.django_admin_log CASCADE;
DROP TABLE IF EXISTS public.authtoken_token CASCADE;
DROP TABLE IF EXISTS public.auth_user_user_permissions CASCADE;
DROP TABLE IF EXISTS public.auth_user_groups CASCADE;
DROP TABLE IF EXISTS public.auth_user CASCADE;
DROP TABLE IF EXISTS public.auth_permission CASCADE;
DROP TABLE IF EXISTS public.auth_group_permissions CASCADE;
DROP TABLE IF EXISTS public.auth_group CASCADE;

-- 5. Drop other unused/legacy tables
DROP TABLE IF EXISTS public.event_interests CASCADE;
DROP TABLE IF EXISTS public.events_ignoredpost CASCADE;
DROP TABLE IF EXISTS public.newsletter_subscribers CASCADE;
DROP TABLE IF EXISTS public.poster_scans CASCADE;
DROP TABLE IF EXISTS public.poster_campaigns CASCADE;
DROP TABLE IF EXISTS public.scrape_runs CASCADE;
DROP TABLE IF EXISTS public.scraped_events CASCADE;
DROP TABLE IF EXISTS public.user_event_rsvps CASCADE;
DROP TABLE IF EXISTS public.waitlist_entries CASCADE;
DROP TABLE IF EXISTS public.alembic_version CASCADE;
DROP TABLE IF EXISTS public.automate_logs CASCADE;

-- 6. Add indexes on events table for school, category, club_type, status
CREATE INDEX IF NOT EXISTS idx_events_school ON public.events(school);
CREATE INDEX IF NOT EXISTS idx_events_category ON public.events(category);
CREATE INDEX IF NOT EXISTS idx_events_club_type ON public.events(club_type);
CREATE INDEX IF NOT EXISTS idx_events_status ON public.events(status);

COMMIT;
