-- Keep the outro image a carousel published.
--
-- The carousel's last slide lists the school's other events from the same
-- scrape window, or points to the school's site when there are none. Like the
-- cover, it is rendered at publish time, and this column holds the PNG URL that
-- was handed to Meta so a published batch keeps showing what was posted.

begin;

alter table public.instagram_publish_batches
  add column if not exists published_outro_url text;

notify pgrst, 'reload schema';

commit;
