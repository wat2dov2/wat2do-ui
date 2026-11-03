-- Clubs that asked wat2do not to post their events on Instagram.
--
-- The daily curation packet carries these handles and the curation prompt
-- tells Claude never to pick them; the carousel's outro leaves them out too.
-- Add a row by hand when a club asks.

begin;

create table if not exists public.instagram_excluded_clubs (
  ig_handle text primary key check (ig_handle = lower(ig_handle) and ig_handle !~ '^@'),
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table public.instagram_excluded_clubs enable row level security;

insert into public.instagram_excluded_clubs (ig_handle, reason)
values ('v1vaclub', 'UWaterloo ViVA asked on Instagram not to be posted')
on conflict (ig_handle) do nothing;

notify pgrst, 'reload schema';

commit;
