BEGIN;

CREATE TABLE IF NOT EXISTS public.discovery_queries (
    id uuid PRIMARY KEY,
    school_id integer NOT NULL REFERENCES public.schools(id) ON DELETE RESTRICT,
    surface text NOT NULL CHECK (surface IN ('events', 'clubs', 'positions')),
    search_query text NOT NULL,
    page_url text NOT NULL,
    filters jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discovery_queries_created_idx
    ON public.discovery_queries (created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS discovery_queries_school_created_idx
    ON public.discovery_queries (school_id, created_at DESC, id DESC);

ALTER TABLE public.discovery_queries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discovery_queries FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.discovery_queries TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
