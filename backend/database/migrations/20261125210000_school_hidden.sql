-- A hidden school exists only for tests, such as the notification agent's
-- end-to-end harness (testu): the notification workflow and ingestion still
-- take its notifications, but the campus picker, its subdomain, the sitemap,
-- carousel drafts and quiet-school reads never show or read it.

ALTER TABLE public.schools
    ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.schools.hidden IS
    'A test school: left out of every public list and automatic job.';
