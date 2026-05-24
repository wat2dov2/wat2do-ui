-- Restore club ownership and assign UWCSA to tqiu@uwaterloo.ca.
--
-- Production is missing clubs.created_by even though /clubs/mine depends on it.
-- Keep this idempotent so it is safe to run after the full migration history.

BEGIN;

ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS created_by uuid;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_clubs_created_by') THEN
        ALTER TABLE public.clubs
            ADD CONSTRAINT fk_clubs_created_by
            FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_clubs_created_by ON public.clubs (created_by);

UPDATE public.clubs
SET
    club_name = 'UWCSA',
    created_by = (
        SELECT id
        FROM public.users
        WHERE email = 'tqiu@uwaterloo.ca'
        LIMIT 1
    )
WHERE id = 23;

NOTIFY pgrst, 'reload schema';

COMMIT;
