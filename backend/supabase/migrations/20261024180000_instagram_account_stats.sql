-- Each publishing account's followers and recent posts, for the admin's social dashboard.
--
-- A daily GitHub workflow reads every connected account from the Graph API.
-- Snapshots keep one row per account per day, so follower growth has a history;
-- media holds each account's newest posts as last read, replaced on every run.

begin;

create table if not exists public.instagram_account_snapshots (
  account_key varchar(100) not null
    references public.instagram_publishing_accounts (account_key) on delete cascade,
  captured_on date not null,
  username varchar(100) not null,
  name text,
  profile_picture_url text,
  followers_count integer not null check (followers_count >= 0),
  follows_count integer not null check (follows_count >= 0),
  media_count integer not null check (media_count >= 0),
  captured_at timestamptz not null default now(),
  primary key (account_key, captured_on)
);

alter table public.instagram_account_snapshots enable row level security;

create table if not exists public.instagram_account_media (
  media_id varchar(64) primary key,
  account_key varchar(100) not null
    references public.instagram_publishing_accounts (account_key) on delete cascade,
  media_type text not null,
  media_product_type text,
  caption text,
  image_url text,
  permalink text not null,
  posted_at timestamptz not null,
  like_count integer check (like_count is null or like_count >= 0),
  comments_count integer check (comments_count is null or comments_count >= 0),
  refreshed_at timestamptz not null default now()
);

comment on column public.instagram_account_media.image_url is
  'Instagram''s signed CDN image (a video''s thumbnail); it expires within days, so each run rewrites it.';

create index if not exists instagram_account_media_account_posted_idx
  on public.instagram_account_media (account_key, posted_at desc);

alter table public.instagram_account_media enable row level security;

notify pgrst, 'reload schema';

commit;
