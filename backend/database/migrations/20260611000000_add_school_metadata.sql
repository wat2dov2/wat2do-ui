-- Add school metadata columns to the schools table to make Supabase the source of truth for all school info
BEGIN;

ALTER TABLE public.schools
ADD COLUMN IF NOT EXISTS timezone VARCHAR(255),
ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
ADD COLUMN IF NOT EXISTS semester_ends TEXT[] NOT NULL DEFAULT '{}'::TEXT[];

-- Seed/update Waterloo with its metadata
UPDATE public.schools
SET
    timezone = 'America/Toronto',
    aliases = ARRAY['uw', 'u of w', 'uwaterloo', 'waterloo'],
    semester_ends = ARRAY['20251231T235959Z', '20260430T235959Z', '20260831T235959Z']
WHERE name = 'University of Waterloo';

NOTIFY pgrst, 'reload schema';

COMMIT;
