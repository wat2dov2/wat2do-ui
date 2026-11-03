create table if not exists public.instagram_publishing_accounts (
  account_key varchar(100) primary key,
  school varchar(255) not null unique,
  instagram_user_id varchar(64) not null unique,
  instagram_username varchar(100) not null,
  encrypted_access_token text not null,
  expires_at timestamptz not null,
  requires_reauthorization boolean not null default false,
  last_validated_at timestamptz not null,
  last_refreshed_at timestamptz,
  refresh_error text,
  refresh_failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_publishing_accounts_user_id_check
    check (instagram_user_id ~ '^[0-9]+$'),
  constraint instagram_publishing_accounts_username_check
    check (length(trim(instagram_username)) > 0)
);

create index if not exists instagram_publishing_accounts_refresh_idx
  on public.instagram_publishing_accounts (
    requires_reauthorization,
    expires_at
  );

alter table public.instagram_publishing_accounts enable row level security;
