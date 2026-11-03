-- Outreach runs on its own: the daily sweep researches every school for every lead
-- type in controlbox/outreach.json, so campaigns go away.
--
-- Both tables were empty when this ran, so the leads table is simply rebuilt
-- without its campaign. Each organizer appears once, however many sweeps find
-- them, so nobody is pitched twice.

BEGIN;

DROP TABLE IF EXISTS public.outreach_leads;
DROP TABLE IF EXISTS public.outreach_campaigns;

CREATE TABLE public.outreach_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    lead_type text NOT NULL CHECK (lead_type ~ '^[a-z0-9_]+$'),
    event_name text NOT NULL CHECK (length(btrim(event_name)) > 0),
    event_url text NOT NULL CHECK (event_url ~ '^https://'),
    event_date date,
    organization text NOT NULL CHECK (length(btrim(organization)) > 0),
    contact_name text NOT NULL DEFAULT '',
    contact_role text NOT NULL DEFAULT '',
    email text NOT NULL UNIQUE CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    source_url text NOT NULL CHECK (source_url ~ '^https://'),
    context text NOT NULL CHECK (length(btrim(context)) > 0),
    video_script text NOT NULL CHECK (length(btrim(video_script)) > 0),
    email_subject text NOT NULL CHECK (length(btrim(email_subject)) > 0),
    email_body text NOT NULL CHECK (length(btrim(email_body)) > 0),
    follow_up text NOT NULL CHECK (length(btrim(follow_up)) > 0),
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'replied', 'submitted', 'not_interested', 'dismissed')),
    notes text NOT NULL DEFAULT '',
    found_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outreach_leads_review_idx
    ON public.outreach_leads (status, found_at DESC, id);

ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outreach_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.outreach_leads TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
