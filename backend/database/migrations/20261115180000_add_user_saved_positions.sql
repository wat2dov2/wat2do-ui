-- The positions each signed-in user saved (bookmarked), like their saved
-- clubs (`user_saved_clubs`). Only the API reads and writes them
-- (`/saved-positions`), so the data API's anonymous and signed-in roles get
-- no access.

CREATE TABLE IF NOT EXISTS public.user_saved_positions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL
        CONSTRAINT fk_user_saved_positions_user_id
        REFERENCES public.users(id) ON DELETE CASCADE,
    position_id bigint NOT NULL
        CONSTRAINT fk_user_saved_positions_position_id
        REFERENCES public.positions(id) ON DELETE CASCADE,
    saved_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_saved_positions_user_id_position_id_key
        UNIQUE (user_id, position_id)
);

CREATE INDEX IF NOT EXISTS ix_user_saved_positions_user_id
    ON public.user_saved_positions (user_id);

ALTER TABLE public.user_saved_positions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_saved_positions FROM PUBLIC;
GRANT ALL ON public.user_saved_positions TO service_role;

COMMENT ON TABLE public.user_saved_positions IS
    'One row per position a user saved, listed newest first by /saved-positions.';
