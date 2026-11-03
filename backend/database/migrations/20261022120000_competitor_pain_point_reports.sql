-- Daily reports Opus writes from the competitor complaints the Mac's sweep found.
--
-- One row per day: a short summary, the recurring themes, and the changes it
-- suggests making to wat2do.io, each citing the complaint links behind it.
-- Admins only read these; nothing is changed automatically.

BEGIN;

CREATE TABLE IF NOT EXISTS public.competitor_pain_point_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    report_date date NOT NULL UNIQUE,
    model text NOT NULL,
    complaint_count integer NOT NULL CHECK (complaint_count >= 0),
    summary text NOT NULL CHECK (length(btrim(summary)) > 0),
    themes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(themes) = 'array'),
    suggestions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(suggestions) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.competitor_pain_point_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.competitor_pain_point_reports FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.competitor_pain_point_reports TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
