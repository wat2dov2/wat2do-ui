-- Keep the images a carousel actually published.
--
-- Slides are still generated from event data at publish time and never stored
-- beforehand: a draft has no images, and editing one changes nothing but the
-- events. What changes here is the other end. Once a carousel is on Instagram
-- its slides are a historical record, and the events behind them keep moving,
-- so a published batch that re-renders from live data no longer shows what was
-- posted. These columns hold the URLs of the PNGs that were handed to Meta.
--
-- Deliberately distinct from the `cover_image_url` / `asset_url` columns that
-- 20260726120000 dropped: those held speculative draft artwork that was
-- rendered before anyone asked for it. These are only ever written after a
-- successful publish, and are never read by the renderer.

begin;

alter table public.instagram_publish_batches
  add column if not exists published_cover_url text;

alter table public.instagram_publish_items
  add column if not exists published_asset_url text;

notify pgrst, 'reload schema';

commit;
