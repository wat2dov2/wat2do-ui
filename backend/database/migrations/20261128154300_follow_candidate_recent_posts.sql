-- The admin Clubs page's Automated follows tab shows, day by day, every account the
-- crawler or a club directory found that a school account followed, with its score
-- and its newest posts.
--
-- recent_posts keeps the newest posts the follow scorer read logged out (url,
-- posted_at, caption cut to the control box's length, image). The image is a signed
-- Instagram CDN link that expires after a few days; the API drops it once its expiry
-- has passed, so the page never shows a broken picture (the reason the first version
-- of this column was dropped in 20261029030000).
--
-- Posts ingestion heard about later come from public.ingestion_items, found by the
-- post's owner, so the index below keeps that lookup off the whole table.

alter table public.instagram_follow_candidates
  add column if not exists recent_posts jsonb not null default '[]'::jsonb;

comment on column public.instagram_follow_candidates.recent_posts is
  'Up to three newest posts the scorer read: url, posted_at, caption, image (a signed CDN link that expires).';

create index if not exists instagram_follow_candidates_followed_at_idx
  on public.instagram_follow_candidates (followed_at desc)
  where followed_at is not null;

create index if not exists ingestion_items_post_owner_idx
  on public.ingestion_items (school_id, (post ->> 'ownerUsername'), created_at desc)
  where source = 'instagram';
