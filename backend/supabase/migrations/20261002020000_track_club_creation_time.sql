-- Keep historical creation times unknown rather than marking the entire directory new.
ALTER TABLE public.clubs ADD COLUMN created_at timestamptz;
ALTER TABLE public.clubs ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN public.clubs.created_at IS
    'Creation time for newly inserted clubs; null for historical rows with unknown dates.';

NOTIFY pgrst, 'reload schema';
