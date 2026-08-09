BEGIN;

ALTER TABLE public.positions
    DROP COLUMN IF EXISTS application_url;

COMMIT;
