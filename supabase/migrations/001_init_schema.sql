-- Wat2Do initial schema for events and clubs.

create extension if not exists pgcrypto;

create table if not exists public.clubs (
  id bigint generated always as identity primary key,
  club_name text not null,
  categories text[] not null default '{}',
  club_page text not null,
  ig text,
  discord text,
  club_type text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id bigint generated always as identity primary key,
  title text not null,
  category text,
  organization text,
  location text not null,
  dtstart_utc timestamptz not null,
  dtend_utc timestamptz,
  food text[] not null default '{}',
  price numeric(10,2),
  registration boolean not null default false,
  description text,
  source_image_url text,
  club_type text,
  school text,
  source_url text,
  ig_handle text,
  discord_handle text,
  x_handle text,
  tiktok_handle text,
  fb_handle text,
  other_handle text,
  display_handle text,
  scraped_at timestamptz not null,
  scraper_source text not null,
  scraper_run_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_events_event_date on public.events (dtstart_utc);
create index if not exists idx_events_location on public.events (location);
create index if not exists idx_events_club_type on public.events (club_type);
create index if not exists idx_clubs_club_type on public.clubs (club_type);

alter table public.events enable row level security;
alter table public.clubs enable row level security;

-- Public users can read events.
create policy "events_public_read"
  on public.events
  for select
  using (true);

-- Only service_role can insert/update/delete events (scraper writes).
create policy "events_service_role_write"
  on public.events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- Public users can read clubs.
create policy "clubs_public_read"
  on public.clubs
  for select
  using (true);

-- Optional: allow service_role to manage clubs as well.
create policy "clubs_service_role_write"
  on public.clubs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
