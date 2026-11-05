-- Media moved from the Mac's disk, served at https://wat2do.io/media/<bucket>/<file>,
-- to Cloudflare R2, served at https://media.wat2do.io/<bucket>/<file> under the
-- same keys. Every stored link to the old address points at the new one; these
-- are all the columns production holds such links in. Both prefixes are 24
-- characters long, so no value outgrows its column.
--
-- A position's "Updated" badge reads updated_at, which its stamping trigger would
-- set to now() for a link that merely moved, so that trigger sits out this update.

BEGIN;

UPDATE public.club_claims
SET proof_url = replace(proof_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/')
WHERE proof_url LIKE '%https://wat2do.io/media/%';

UPDATE public.event_submissions
SET event_data = replace(
    event_data::text, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)::jsonb
WHERE event_data::text LIKE '%https://wat2do.io/media/%';

UPDATE public.clubs
SET logo_url = replace(logo_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/')
WHERE logo_url LIKE '%https://wat2do.io/media/%';

UPDATE public.events
SET description = replace(description, 'https://wat2do.io/media/', 'https://media.wat2do.io/')
WHERE description LIKE '%https://wat2do.io/media/%';

UPDATE public.events
SET source_image_url = replace(
    source_image_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE source_image_url LIKE '%https://wat2do.io/media/%';

UPDATE public.events
SET source_video_url = replace(
    source_video_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE source_video_url LIKE '%https://wat2do.io/media/%';

UPDATE public.instagram_publish_batches
SET published_cover_url = replace(
    published_cover_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE published_cover_url LIKE '%https://wat2do.io/media/%';

UPDATE public.instagram_publish_batches
SET published_outro_url = replace(
    published_outro_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE published_outro_url LIKE '%https://wat2do.io/media/%';

UPDATE public.instagram_publish_items
SET published_asset_url = replace(
    published_asset_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE published_asset_url LIKE '%https://wat2do.io/media/%';

UPDATE public.users
SET avatar_url = replace(avatar_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/')
WHERE avatar_url LIKE '%https://wat2do.io/media/%';

ALTER TABLE public.positions DISABLE TRIGGER stamp_position_updated_at;
UPDATE public.positions
SET source_image_url = replace(
    source_image_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE source_image_url LIKE '%https://wat2do.io/media/%';
ALTER TABLE public.positions ENABLE TRIGGER stamp_position_updated_at;

UPDATE public.schools
SET poster_logo_url = replace(
    poster_logo_url, 'https://wat2do.io/media/', 'https://media.wat2do.io/'
)
WHERE poster_logo_url LIKE '%https://wat2do.io/media/%';

COMMIT;
