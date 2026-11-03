-- Restore normal-user event submissions and rename operational ingestion
-- tracking from scrape_runs to workflow_runs.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.workflow_runs') IS NULL
       AND to_regclass('public.scrape_runs') IS NOT NULL THEN
        ALTER TABLE public.scrape_runs RENAME TO workflow_runs;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.workflow_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ig_username text NOT NULL,
    github_run_id text,
    status text NOT NULL DEFAULT 'running',
    posts_fetched integer NOT NULL DEFAULT 0,
    posts_new integer NOT NULL DEFAULT 0,
    events_extracted integer NOT NULL DEFAULT 0,
    events_saved integer NOT NULL DEFAULT 0,
    pinned_post_warning boolean NOT NULL DEFAULT false,
    error_message text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    CONSTRAINT chk_workflow_runs_counts_non_negative
        CHECK (posts_fetched >= 0
           AND posts_new >= 0
           AND events_extracted >= 0
           AND events_saved >= 0)
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_scrape_runs_counts_non_negative'
    ) AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_workflow_runs_counts_non_negative'
    ) THEN
        ALTER TABLE public.workflow_runs
            RENAME CONSTRAINT chk_scrape_runs_counts_non_negative
            TO chk_workflow_runs_counts_non_negative;
    END IF;
END $$;

ALTER TABLE public.workflow_runs ENABLE ROW LEVEL SECURITY;

DROP INDEX IF EXISTS public.ix_scrape_runs_username_started;
DROP INDEX IF EXISTS public.ix_scrape_runs_status;
DROP INDEX IF EXISTS public.ix_scrape_runs_started_at;

CREATE INDEX IF NOT EXISTS ix_workflow_runs_username_started
    ON public.workflow_runs (ig_username, started_at DESC);
CREATE INDEX IF NOT EXISTS ix_workflow_runs_status
    ON public.workflow_runs (status);
CREATE INDEX IF NOT EXISTS ix_workflow_runs_started_at
    ON public.workflow_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.event_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_data jsonb NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    rejection_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone,
    CONSTRAINT event_submissions_pkey PRIMARY KEY (id),
    CONSTRAINT chk_event_submissions_status_valid
        CHECK (status IN ('pending', 'approved', 'rejected'))
);

ALTER TABLE public.event_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_event_submissions_user_id'
    ) THEN
        ALTER TABLE public.event_submissions
            ADD CONSTRAINT fk_event_submissions_user_id
            FOREIGN KEY (user_id)
            REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_event_submissions_status
    ON public.event_submissions (status);
CREATE INDEX IF NOT EXISTS idx_event_submissions_user_id
    ON public.event_submissions (user_id);

DROP TABLE IF EXISTS public.user_event_rsvps CASCADE;
DROP TABLE IF EXISTS public.scraped_events CASCADE;
DROP TABLE IF EXISTS public.alembic_version CASCADE;
DROP TABLE IF EXISTS public.schema_migrations CASCADE;

REVOKE ALL ON public.workflow_runs FROM PUBLIC;
REVOKE ALL ON public.event_submissions FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON public.workflow_runs FROM anon';
        EXECUTE 'REVOKE ALL ON public.event_submissions FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON public.workflow_runs FROM authenticated';
        EXECUTE 'REVOKE ALL ON public.event_submissions FROM authenticated';
    END IF;
END $$;
GRANT ALL ON public.workflow_runs TO service_role;
GRANT ALL ON public.event_submissions TO service_role;

COMMIT;
