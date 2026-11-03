-- Accounts a school's Instagram account should follow: the one queue every feature adds
-- to, whether a weekly crawl of the Following lists of the clubs it already follows
-- found the account, a club was added, or an earlier review list was imported.
--
-- One row per school and handle, kept whatever its status, so a rejected account is
-- never offered again. Approving creates the club and queues the follow; the
-- emulator follows approved accounts from the school's account.

begin;

create table if not exists public.instagram_follow_candidates (
  id uuid primary key default gen_random_uuid(),
  school_id integer not null references public.schools (id) on delete cascade,
  handle varchar(100) not null,
  name text,
  source text not null check (source in ('crawl', 'club', 'import')),
  -- The followed accounts whose Following lists showed it.
  found_via text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'followed')),
  -- The newest posts as read logged out, so a reviewer sees what it posts.
  read_status text check (read_status in ('ok', 'no_posts', 'failed')),
  followers_count integer check (followers_count is null or followers_count >= 0),
  posts_count integer check (posts_count is null or posts_count >= 0),
  is_private boolean,
  last_posted_at timestamptz,
  recent_posts jsonb not null default '[]'::jsonb,
  score smallint check (score is null or score between 0 and 100),
  verdict text check (verdict in ('approve', 'review', 'reject')),
  reason text,
  scored_at timestamptz,
  club_id integer references public.clubs (id) on delete set null,
  decided_by uuid references public.users (id) on delete set null,
  decided_at timestamptz,
  followed_at timestamptz,
  follow_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, handle)
);

comment on column public.instagram_follow_candidates.recent_posts is
  'Up to three newest posts: url, posted_at, caption, image (a signed CDN link that expires).';

create index if not exists instagram_follow_candidates_status_idx
  on public.instagram_follow_candidates (status, school_id, score desc nulls last);

alter table public.instagram_follow_candidates enable row level security;

-- One row per crawl, so each school's crawl starts at most once a week.
create table if not exists public.instagram_follow_crawls (
  id uuid primary key default gen_random_uuid(),
  school_id integer not null references public.schools (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'finished')),
  visited_count integer not null default 0 check (visited_count >= 0),
  found_count integer not null default 0 check (found_count >= 0)
);

create index if not exists instagram_follow_crawls_school_idx
  on public.instagram_follow_crawls (school_id, started_at desc);

alter table public.instagram_follow_crawls enable row level security;

notify pgrst, 'reload schema';

commit;
