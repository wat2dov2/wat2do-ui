-- Keep one school-scoped freshness token for event-feed social previews.
-- Event writes make the school dirty immediately; a bounded scheduled worker
-- renders the latest revision at most once per six-hour cycle.

BEGIN;

ALTER TABLE public.schools
  ADD COLUMN social_preview_image_url text,
  ADD COLUMN social_preview_revision bigint NOT NULL DEFAULT 1,
  ADD COLUMN social_preview_rendered_revision bigint NOT NULL DEFAULT 0,
  ADD COLUMN social_preview_rendered_at timestamptz;

ALTER TABLE public.schools
  ADD CONSTRAINT schools_social_preview_revision_check
  CHECK (
    social_preview_revision >= 0
    AND social_preview_rendered_revision >= 0
    AND social_preview_rendered_revision <= social_preview_revision
  ),
  ADD CONSTRAINT schools_social_preview_image_url_check
  CHECK (
    social_preview_image_url IS NULL
    OR social_preview_image_url ~ '^https://'
  );

CREATE FUNCTION public.mark_school_social_preview_dirty(
  p_school_id integer
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_revision bigint;
BEGIN
  UPDATE public.schools
  SET social_preview_revision = social_preview_revision + 1
  WHERE id = p_school_id
  RETURNING social_preview_revision INTO next_revision;

  RETURN next_revision;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_school_social_preview_dirty(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_school_social_preview_dirty(integer) TO service_role;

CREATE FUNCTION public.mark_event_school_social_preview_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.mark_school_social_preview_dirty(OLD.school_id);
    RETURN OLD;
  END IF;

  PERFORM public.mark_school_social_preview_dirty(NEW.school_id);
  IF TG_OP = 'UPDATE' AND OLD.school_id IS DISTINCT FROM NEW.school_id THEN
    PERFORM public.mark_school_social_preview_dirty(OLD.school_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER events_mark_school_social_preview_dirty
AFTER INSERT OR DELETE OR UPDATE OF
  title,
  description,
  location,
  price,
  food,
  registration,
  source_image_url,
  school_id,
  category,
  organization,
  cancelled
ON public.events
FOR EACH ROW
EXECUTE FUNCTION public.mark_event_school_social_preview_dirty();

CREATE FUNCTION public.mark_event_date_school_social_preview_dirty()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected_event_id bigint;
  affected_school_id integer;
BEGIN
  affected_event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;

  SELECT school_id
  INTO affected_school_id
  FROM public.events
  WHERE id = affected_event_id;

  IF affected_school_id IS NOT NULL THEN
    PERFORM public.mark_school_social_preview_dirty(affected_school_id);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_dates_mark_school_social_preview_dirty
AFTER INSERT OR UPDATE OR DELETE ON public.event_dates
FOR EACH ROW
EXECUTE FUNCTION public.mark_event_date_school_social_preview_dirty();

NOTIFY pgrst, 'reload schema';

COMMIT;
