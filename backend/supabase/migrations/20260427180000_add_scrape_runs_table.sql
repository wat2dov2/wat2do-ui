-- Migration: add_scrape_runs_table
-- Created: 2026-04-27
--
-- Per-Instagram-username scrape job tracking for services/wat2do.
--
-- One row per (username, github_run) attempt. Rows progress through the
-- status states defined in core/constants.SCRAPE_RUN_STATUSES. Dry-run
-- mode skips inserts entirely (matches v1 behaviour from commit bb1595b
-- so a dry-run produces no rows in this table).
--
-- Shape mirrors v1's apps/scraping/models.py ScrapeRun, ported to the
-- v2 column conventions: snake_case + timestamptz + IF NOT EXISTS guards.
-- ``status`` is plain text rather than a CHECK constraint so adding a
-- new status (e.g. ``aborted``) is a code change only.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.scrape_runs (
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

    CONSTRAINT chk_scrape_runs_counts_non_negative
        CHECK (posts_fetched >= 0
           AND posts_new >= 0
           AND events_extracted >= 0
           AND events_saved >= 0)
);

-- 2. RLS ---------------------------------------------------------------
-- Service-role bypasses RLS; enabling with no policies blocks the
-- anon / authenticated roles in case any future code path uses the
-- anon client. Scraping is admin-only operational data — never exposed
-- to the public PostgREST surface.
ALTER TABLE public.scrape_runs ENABLE ROW LEVEL SECURITY;

-- 3. Indexes -----------------------------------------------------------
-- Recent-runs-by-user view (the most common admin query).
CREATE INDEX IF NOT EXISTS ix_scrape_runs_username_started
    ON public.scrape_runs (ig_username, started_at DESC);

-- Status-filtered queries (e.g. dashboards showing failures).
CREATE INDEX IF NOT EXISTS ix_scrape_runs_status
    ON public.scrape_runs (status);

-- Time-window queries (e.g. "all runs in the last 24h").
CREATE INDEX IF NOT EXISTS ix_scrape_runs_started_at
    ON public.scrape_runs (started_at DESC);

COMMIT;
