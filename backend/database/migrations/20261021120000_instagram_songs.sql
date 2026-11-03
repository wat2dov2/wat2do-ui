-- Songs for published carousels, added from the Instagram app instead of suggested.
--
-- Admins list songs the way they would say them ("the weeknd after hours").
-- After a carousel publishes, the Mac's emulator job tries them in random order
-- on the live post and records the outcome on the batch. The chart-based song
-- suggestion this replaces is dropped.

begin;

alter table public.instagram_publish_batches
  drop constraint if exists instagram_publish_batches_suggested_song_object,
  drop column if exists suggested_song;

create table if not exists public.instagram_songs (
  id uuid primary key default gen_random_uuid(),
  query text not null check (query = btrim(query) and char_length(query) between 1 and 200),
  created_at timestamptz not null default now()
);

create unique index if not exists instagram_songs_query_key
  on public.instagram_songs (lower(query));

alter table public.instagram_songs enable row level security;

alter table public.instagram_publish_batches
  add column if not exists permalink text,
  add column if not exists music_status text,
  add column if not exists music_track text,
  add column if not exists music_error text,
  add column if not exists music_attempts integer not null default 0,
  add constraint instagram_publish_batches_music_status_check
    check (music_status is null or music_status in ('pending', 'added', 'failed')),
  add constraint instagram_publish_batches_music_attempts_check
    check (music_attempts >= 0);

comment on column public.instagram_publish_batches.permalink is
  'The live post''s Instagram URL, read from the Graph API when it publishes.';
comment on column public.instagram_publish_batches.music_status is
  'pending until the emulator job adds a song to the live post, then added or failed.';
comment on column public.instagram_publish_batches.music_track is
  'The Instagram track the emulator added, as "Title by Artist".';

create index if not exists instagram_publish_batches_music_pending_idx
  on public.instagram_publish_batches (published_at)
  where music_status = 'pending';

notify pgrst, 'reload schema';

commit;
