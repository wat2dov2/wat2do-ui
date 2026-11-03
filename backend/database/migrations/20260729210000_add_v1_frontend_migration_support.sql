BEGIN;

CREATE TABLE public.v1_user_mappings (
    clerk_user_id text PRIMARY KEY,
    user_id uuid NOT NULL UNIQUE
        REFERENCES public.users(id) ON DELETE CASCADE,
    imported_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT v1_user_mappings_clerk_user_id_nonempty
        CHECK (length(btrim(clerk_user_id)) > 0)
);

ALTER TABLE public.v1_user_mappings ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.v1_saved_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL
        REFERENCES public.users(id) ON DELETE CASCADE,
    event_id integer NOT NULL
        REFERENCES public.events(id) ON DELETE CASCADE,
    saved_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT v1_saved_events_user_id_event_id_key
        UNIQUE (user_id, event_id)
);

ALTER TABLE public.v1_saved_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_v1_saved_events_user_id
    ON public.v1_saved_events (user_id, saved_at DESC);

CREATE INDEX ix_v1_saved_events_event_id
    ON public.v1_saved_events (event_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
