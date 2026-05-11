-- Migration: backfill_missing_tables
-- Created: 2026-05-05
--
-- One-shot: creates every table/view that the current backend code expects
-- but is missing from the production database. Fully idempotent — safe to
-- re-run.
--
-- Context: the baseline migration (20260101000000) was never applied to
-- production, and several later migrations also didn't land. Rather than
-- replay 10+ migration files in order, this file creates everything the
-- backend currently references in core/tables.py that doesn't exist yet.
--
-- Run via: Supabase Dashboard → SQL Editor → paste entire file → Run.

BEGIN;

-- ── 0. Add missing columns to existing tables ─────────────────────────
-- The production events/users tables are missing columns the backend code
-- references in inserts and selects.

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS category character varying(100);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS organization character varying(255);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS display_handle character varying(255);
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS created_by text;

-- Normalize legacy status values (CONFIRMED → active, CANCELLED → cancelled).
-- The add_event_status_column migration was a no-op because the status column
-- pre-existed with v1 enums.
UPDATE public.events SET status = 'CONFIRMED' WHERE status = 'CONFIRMED';
UPDATE public.events SET status = 'CANCELLED' WHERE status = 'CANCELLED';

-- Add the CHECK constraint that should have been added by the status migration.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'events_status_check') THEN
        ALTER TABLE public.events ADD CONSTRAINT events_status_check CHECK (status IN ('CONFIRMED', 'CANCELLED'));
    END IF;
END$$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS role text DEFAULT 'user'::text NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS school character varying(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS faculty character varying(255);
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS interests jsonb;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_first_year boolean DEFAULT false NOT NULL;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS calendar_feed_token text;

-- Add missing indexes/constraints on the newly added columns.
CREATE INDEX IF NOT EXISTS idx_users_role ON public.users (role);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role_valid') THEN
        ALTER TABLE public.users ADD CONSTRAINT chk_users_role_valid CHECK (role IN ('user', 'admin'));
    END IF;
END$$;

-- ── 1. club_integrations ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.club_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id integer NOT NULL,
    platform character varying(32) NOT NULL,
    connected boolean DEFAULT false NOT NULL,
    name text,
    last_sync timestamp with time zone,
    server_id text,
    server_name text,
    channel_id text,
    channel_name text,
    handle text,
    group_id text,
    group_name text,
    page_id text,
    page_name text,
    connection_type character varying(16),
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.club_integrations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_integrations_pkey') THEN
        ALTER TABLE ONLY public.club_integrations ADD CONSTRAINT club_integrations_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_integrations_club_id_platform_key') THEN
        ALTER TABLE ONLY public.club_integrations ADD CONSTRAINT club_integrations_club_id_platform_key UNIQUE (club_id, platform);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'club_integrations_club_id_fkey') THEN
        ALTER TABLE ONLY public.club_integrations ADD CONSTRAINT club_integrations_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_club_integrations_club_id ON public.club_integrations (club_id);
CREATE INDEX IF NOT EXISTS idx_club_integrations_platform ON public.club_integrations (platform);
CREATE INDEX IF NOT EXISTS idx_club_integrations_connected ON public.club_integrations (connected);

-- ── 2. qr_codes ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_codes (
    id character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    destination_type character varying(32) NOT NULL,
    destination_id character varying(512),
    filters jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    image_url character varying(1024),
    latitude double precision DEFAULT '0'::double precision,
    longitude double precision DEFAULT '0'::double precision
);

ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qr_codes_pkey') THEN
        ALTER TABLE ONLY public.qr_codes ADD CONSTRAINT qr_codes_pkey PRIMARY KEY (id);
    END IF;
END$$;

-- ── 3. qr_code_scans ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.qr_code_scans (
    id uuid NOT NULL,
    qr_code_id character varying(64) NOT NULL,
    scanned_at timestamp with time zone DEFAULT now(),
    user_id character varying(255),
    session_id character varying(255) NOT NULL,
    conversion_actions jsonb DEFAULT '[]'::jsonb,
    user_agent character varying(512)
);

ALTER TABLE public.qr_code_scans ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qr_code_scans_pkey') THEN
        ALTER TABLE ONLY public.qr_code_scans ADD CONSTRAINT qr_code_scans_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'qr_code_scans_qr_code_id_fkey') THEN
        ALTER TABLE ONLY public.qr_code_scans ADD CONSTRAINT qr_code_scans_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_qr_code_scans_qr_code_id ON public.qr_code_scans (qr_code_id);

-- ── 4. user_saved_events ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_saved_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    saved_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.user_saved_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_saved_events_pkey') THEN
        ALTER TABLE ONLY public.user_saved_events ADD CONSTRAINT user_saved_events_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_saved_events_user_id_event_id_key') THEN
        ALTER TABLE ONLY public.user_saved_events ADD CONSTRAINT user_saved_events_user_id_event_id_key UNIQUE (user_id, event_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_saved_events_event_id') THEN
        ALTER TABLE ONLY public.user_saved_events ADD CONSTRAINT fk_user_saved_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_saved_events_user_id') THEN
        ALTER TABLE ONLY public.user_saved_events ADD CONSTRAINT fk_user_saved_events_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_user_saved_events_user_id ON public.user_saved_events (user_id);

-- ── 5. user_event_rsvps ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_event_rsvps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    rsvped_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.user_event_rsvps ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_event_rsvps_pkey') THEN
        ALTER TABLE ONLY public.user_event_rsvps ADD CONSTRAINT user_event_rsvps_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_event_rsvps_user_id_event_id_key') THEN
        ALTER TABLE ONLY public.user_event_rsvps ADD CONSTRAINT user_event_rsvps_user_id_event_id_key UNIQUE (user_id, event_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_event_rsvps_event_id') THEN
        ALTER TABLE ONLY public.user_event_rsvps ADD CONSTRAINT fk_user_event_rsvps_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_event_rsvps_user_id') THEN
        ALTER TABLE ONLY public.user_event_rsvps ADD CONSTRAINT fk_user_event_rsvps_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_user_event_rsvps_user_id ON public.user_event_rsvps (user_id);

-- ── 6. user_interactions ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id character varying(255) NOT NULL,
    event_id integer NOT NULL,
    interaction_type character varying(32) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_interactions_pkey') THEN
        ALTER TABLE ONLY public.user_interactions ADD CONSTRAINT user_interactions_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_interactions_event_id') THEN
        ALTER TABLE ONLY public.user_interactions ADD CONSTRAINT fk_user_interactions_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_interactions_user_id') THEN
        ALTER TABLE ONLY public.user_interactions ADD CONSTRAINT fk_user_interactions_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_interactions_metadata_size') THEN
        ALTER TABLE ONLY public.user_interactions ADD CONSTRAINT chk_user_interactions_metadata_size CHECK (metadata IS NULL OR octet_length(metadata::text) <= 2048);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_user_interactions_user_created ON public.user_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_user_interactions_event_id ON public.user_interactions (event_id);
CREATE INDEX IF NOT EXISTS ix_user_interactions_user_event ON public.user_interactions (user_id, event_id);
CREATE INDEX IF NOT EXISTS ix_user_interactions_created_at ON public.user_interactions (created_at);

-- ── 7. user_recommendations ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_recommendations (
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    rank integer NOT NULL,
    predicted_score double precision NOT NULL,
    reason character varying(255),
    computed_at timestamp with time zone DEFAULT now()
);

ALTER TABLE public.user_recommendations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_recommendations_pkey') THEN
        ALTER TABLE ONLY public.user_recommendations ADD CONSTRAINT user_recommendations_pkey PRIMARY KEY (user_id, event_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_recommendations_event_id') THEN
        ALTER TABLE ONLY public.user_recommendations ADD CONSTRAINT fk_user_recommendations_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_recommendations_user_id') THEN
        ALTER TABLE ONLY public.user_recommendations ADD CONSTRAINT fk_user_recommendations_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_recommendations_score_finite_nonneg') THEN
        ALTER TABLE ONLY public.user_recommendations ADD CONSTRAINT chk_user_recommendations_score_finite_nonneg CHECK (predicted_score IS NOT NULL AND predicted_score <> 'NaN'::float8 AND predicted_score <> 'Infinity'::float8 AND predicted_score <> '-Infinity'::float8 AND predicted_score >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_recommendations_rank_positive') THEN
        ALTER TABLE ONLY public.user_recommendations ADD CONSTRAINT chk_user_recommendations_rank_positive CHECK (rank IS NOT NULL AND rank >= 1);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_user_recommendations_user_rank ON public.user_recommendations (user_id, rank);

-- ── 8. user_credits ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance integer DEFAULT 100 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_credits_pkey') THEN
        ALTER TABLE ONLY public.user_credits ADD CONSTRAINT user_credits_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_credits_user_id_key') THEN
        ALTER TABLE ONLY public.user_credits ADD CONSTRAINT user_credits_user_id_key UNIQUE (user_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_user_credits_user_id') THEN
        ALTER TABLE ONLY public.user_credits ADD CONSTRAINT fk_user_credits_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_user_credits_balance_non_negative') THEN
        ALTER TABLE ONLY public.user_credits ADD CONSTRAINT chk_user_credits_balance_non_negative CHECK (balance >= 0);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_user_credits_user_id ON public.user_credits (user_id);

-- ── 9. reported_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.reported_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id integer NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);

ALTER TABLE public.reported_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reported_events_pkey') THEN
        ALTER TABLE ONLY public.reported_events ADD CONSTRAINT reported_events_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reported_events_event_id') THEN
        ALTER TABLE ONLY public.reported_events ADD CONSTRAINT fk_reported_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_reported_events_user_id') THEN
        ALTER TABLE ONLY public.reported_events ADD CONSTRAINT fk_reported_events_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_reported_events_status_valid') THEN
        ALTER TABLE ONLY public.reported_events ADD CONSTRAINT chk_reported_events_status_valid CHECK (status IN ('pending', 'resolved', 'dismissed'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_reported_events_event_id ON public.reported_events (event_id);
CREATE INDEX IF NOT EXISTS idx_reported_events_status ON public.reported_events (status);

-- ── 10. scraped_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scraped_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id integer,
    source character varying(255) NOT NULL,
    scraped_at timestamp with time zone DEFAULT now() NOT NULL,
    raw_data jsonb
);

ALTER TABLE public.scraped_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'scraped_events_pkey') THEN
        ALTER TABLE ONLY public.scraped_events ADD CONSTRAINT scraped_events_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_scraped_events_event_id') THEN
        ALTER TABLE ONLY public.scraped_events ADD CONSTRAINT fk_scraped_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_scraped_events_source ON public.scraped_events (source);

-- ── 11. ab_test_events ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ab_test_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_id integer,
    variant character varying(32) NOT NULL,
    event_type character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    experiment_name character varying(64) NOT NULL
);

ALTER TABLE public.ab_test_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ab_test_events_pkey') THEN
        ALTER TABLE ONLY public.ab_test_events ADD CONSTRAINT ab_test_events_pkey PRIMARY KEY (id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ab_test_events_event_id') THEN
        ALTER TABLE ONLY public.ab_test_events ADD CONSTRAINT fk_ab_test_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ab_test_events_user_id') THEN
        ALTER TABLE ONLY public.ab_test_events ADD CONSTRAINT fk_ab_test_events_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ab_test_events_variant') THEN
        ALTER TABLE ONLY public.ab_test_events ADD CONSTRAINT chk_ab_test_events_variant CHECK (variant IN ('control', 'treatment'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ab_test_events_event_type') THEN
        ALTER TABLE ONLY public.ab_test_events ADD CONSTRAINT chk_ab_test_events_event_type CHECK (event_type IN ('impression', 'click'));
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_ab_test_events_experiment ON public.ab_test_events (experiment_name, variant, event_type);
CREATE INDEX IF NOT EXISTS ix_ab_test_events_variant ON public.ab_test_events (variant);

-- ── 12. notification_preferences ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    enabled boolean NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notification_preferences_user_type_key UNIQUE (user_id, notification_type)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notification_preferences_user_id') THEN
        ALTER TABLE public.notification_preferences ADD CONSTRAINT fk_notification_preferences_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_notification_preferences_user_id ON public.notification_preferences (user_id);

-- ── 13. notifications_log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notifications_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    target_id text NOT NULL,
    channel text NOT NULL DEFAULT 'email',
    status text NOT NULL,
    changed_fields jsonb,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_log_status_check CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT notifications_log_dedup_key UNIQUE (user_id, notification_type, target_id, channel)
);

ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_notifications_log_user_id') THEN
        ALTER TABLE public.notifications_log ADD CONSTRAINT fk_notifications_log_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS ix_notifications_log_user_type ON public.notifications_log (user_id, notification_type);
CREATE INDEX IF NOT EXISTS ix_notifications_log_pending ON public.notifications_log (created_at) WHERE status = 'pending';

-- ── 14. events_listing VIEW ───────────────────────────────────────────
-- Read-side compatibility shim: LEFT JOINs events × event_dates so
-- date-range filters work on the combined projection. security_invoker
-- makes it honour RLS on the underlying tables.
CREATE OR REPLACE VIEW public.events_listing
WITH (security_invoker = true) AS
SELECT
    events.*,
    event_dates.id          AS event_date_id,
    event_dates.dtstart_utc AS dtstart_utc,
    event_dates.dtend_utc   AS dtend_utc,
    event_dates.tz          AS tz
FROM public.events
LEFT JOIN public.event_dates ON event_dates.event_id = events.id;

REVOKE ALL ON public.events_listing FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.events_listing FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.events_listing FROM authenticated';
    END IF;
END$$;

COMMIT;
