-- Asian and K-pop songs play only on campuses with large Asian student communities.
--
-- The emulator job tries a flagged song only for the schools listed in
-- controlbox/instagram_publishing.json `asian_song_schools`; every other song can
-- play anywhere.

begin;

alter table public.instagram_songs
  add column if not exists asian_campuses_only boolean not null default false;

comment on column public.instagram_songs.asian_campuses_only is
  'True for Asian and K-pop songs, which are tried only at the controlbox''s asian_song_schools.';

notify pgrst, 'reload schema';

commit;
