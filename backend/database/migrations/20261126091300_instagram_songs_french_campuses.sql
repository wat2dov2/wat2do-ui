-- French-language songs play only on the controlbox's french_song_schools (French-language campuses),
-- the way Asian and K-pop songs play only at the controlbox's asian_song_schools.
--
-- A song belongs to one group of campuses at most: Asian, French or neither (every
-- other campus). French campuses play only the French songs.

alter table public.instagram_songs
  add column if not exists french_campuses_only boolean not null default false;

comment on column public.instagram_songs.french_campuses_only is
  'True for French-language songs, which are tried only at the controlbox''s french_song_schools, and are the only songs tried there.';

alter table public.instagram_songs
  drop constraint if exists instagram_songs_one_campus_group;
alter table public.instagram_songs
  add constraint instagram_songs_one_campus_group
  check (not (asian_campuses_only and french_campuses_only));
