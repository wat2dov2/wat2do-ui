-- Outreach campaigns and the organizers the Mac's research agent finds for them.
--
-- A campaign names the kind of event Wat2Do wants submitted (hackathons,
-- ticketed events). Each lead is one organizer of one upcoming event, with the
-- page their email was found on, a short brief, and the video script and email
-- an admin sends from Gmail. Lead types come from controlbox/outreach.json.

BEGIN;

CREATE TABLE IF NOT EXISTS public.outreach_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    lead_type text NOT NULL CHECK (lead_type ~ '^[a-z0-9_]+$'),
    goal text NOT NULL DEFAULT '',
    -- Empty means every school.
    school_slugs text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done')),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.outreach_leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid NOT NULL REFERENCES public.outreach_campaigns(id) ON DELETE CASCADE,
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    event_name text NOT NULL CHECK (length(btrim(event_name)) > 0),
    event_url text NOT NULL CHECK (event_url ~ '^https://'),
    event_date date,
    organization text NOT NULL CHECK (length(btrim(organization)) > 0),
    contact_name text NOT NULL DEFAULT '',
    contact_role text NOT NULL DEFAULT '',
    email text NOT NULL CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    source_url text NOT NULL CHECK (source_url ~ '^https://'),
    context text NOT NULL CHECK (length(btrim(context)) > 0),
    video_script text NOT NULL CHECK (length(btrim(video_script)) > 0),
    email_subject text NOT NULL CHECK (length(btrim(email_subject)) > 0),
    email_body text NOT NULL CHECK (length(btrim(email_body)) > 0),
    follow_up text NOT NULL CHECK (length(btrim(follow_up)) > 0),
    status text NOT NULL DEFAULT 'new'
        CHECK (status IN ('new', 'contacted', 'replied', 'submitted', 'not_interested', 'dismissed')),
    notes text NOT NULL DEFAULT '',
    found_at timestamptz NOT NULL DEFAULT now(),
    -- One email per organizer per campaign, so a weekly sweep never re-pitches anyone.
    UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS outreach_leads_review_idx
    ON public.outreach_leads (campaign_id, status, found_at DESC, id);

ALTER TABLE public.outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.outreach_leads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outreach_campaigns FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.outreach_leads FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.outreach_campaigns TO service_role;
GRANT ALL ON public.outreach_leads TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
