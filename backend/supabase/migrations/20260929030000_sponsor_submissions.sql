BEGIN;

CREATE TABLE IF NOT EXISTS public.sponsor_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    business_name text NOT NULL CHECK (length(btrim(business_name)) > 0),
    email text NOT NULL,
    message text NOT NULL CHECK (length(btrim(message)) > 0),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    submitted_at timestamptz NOT NULL DEFAULT now(),
    reviewed_at timestamptz,
    reviewed_by uuid REFERENCES public.users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS sponsor_submissions_review_idx
    ON public.sponsor_submissions (status, submitted_at DESC, id);
ALTER TABLE public.sponsor_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sponsor_submissions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.sponsor_submissions TO service_role;

COMMIT;
