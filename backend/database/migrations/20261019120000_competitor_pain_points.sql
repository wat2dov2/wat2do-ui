-- Public complaints about competitors, found by the Mac's Haiku sweep.
--
-- Each row is one review or post someone wrote about a competitor, kept so an
-- admin can read the pain point and decide what to do. wat2do never replies.
-- Competitor and source slugs come from controlbox/competitor_pain_points.json.

BEGIN;

CREATE TABLE IF NOT EXISTS public.competitor_pain_points (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competitor text NOT NULL CHECK (competitor ~ '^[a-z0-9_]+$'),
    source text NOT NULL CHECK (source ~ '^[a-z0-9_]+$'),
    url text NOT NULL UNIQUE CHECK (url ~ '^https://'),
    author text NOT NULL DEFAULT '',
    quote text NOT NULL CHECK (length(btrim(quote)) > 0),
    pain_point text NOT NULL CHECK (length(btrim(pain_point)) > 0),
    audience text NOT NULL CHECK (audience IN ('organizer', 'attendee', 'other')),
    posted_at timestamptz,
    found_at timestamptz NOT NULL DEFAULT now(),
    status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'dismissed'))
);
CREATE INDEX IF NOT EXISTS competitor_pain_points_review_idx
    ON public.competitor_pain_points (status, found_at DESC, id);
ALTER TABLE public.competitor_pain_points ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competitor_pain_points FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.competitor_pain_points TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
