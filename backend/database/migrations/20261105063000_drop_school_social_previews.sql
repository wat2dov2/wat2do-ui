-- School link previews are now drawn by the frontend on request
-- (frontend/src/app/og-image.png/route.tsx) from the school and its event feed,
-- so the screenshot Lambda, the stored image URL and the revision counters that
-- told it which schools to capture again are gone. The event and event-date
-- triggers go first: they write social_preview_revision on every event change.
-- Nothing else depends on these columns; anything that did stops this migration
-- instead of being dropped with it.
--
-- Run only once every release has stopped reading these columns: the API's
-- school lookups selected social_preview_image_url until this change.

BEGIN;

DROP TRIGGER IF EXISTS events_mark_school_social_preview_dirty ON public.events;
DROP TRIGGER IF EXISTS event_dates_mark_school_social_preview_dirty ON public.event_dates;
DROP FUNCTION IF EXISTS public.mark_event_school_social_preview_dirty();
DROP FUNCTION IF EXISTS public.mark_event_date_school_social_preview_dirty();
DROP FUNCTION IF EXISTS public.mark_school_social_preview_dirty(integer);

ALTER TABLE public.schools
  DROP CONSTRAINT IF EXISTS schools_social_preview_revision_check,
  DROP CONSTRAINT IF EXISTS schools_social_preview_image_url_check,
  DROP COLUMN IF EXISTS social_preview_image_url,
  DROP COLUMN IF EXISTS social_preview_revision,
  DROP COLUMN IF EXISTS social_preview_rendered_revision,
  DROP COLUMN IF EXISTS social_preview_rendered_at;

-- The data API forgets the dropped columns.
NOTIFY pgrst, 'reload schema';

COMMIT;
