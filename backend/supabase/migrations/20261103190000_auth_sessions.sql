-- Login sessions for our own auth service, which replaces Supabase Auth.
--
-- One row per signed-in browser. The browser holds an opaque refresh token in an
-- httpOnly cookie; only its SHA-256 hash is stored here. Each refresh replaces the
-- hash with the successor's and keeps the old one as previous_refresh_token_hash,
-- so a parallel refresh that sends the old token within the reuse window gets the
-- same successor, and an old token sent later revokes the session.
--
-- auth_id is the JWT subject, the same value as users.supabase_auth_id.
--
-- Sessions that are live in Supabase Auth are copied in with their current refresh
-- token, so nobody is logged out when the backend stops calling Supabase. Running
-- this file again picks up tokens Supabase rotated since, but never overwrites a
-- session our service has already rotated.

begin;

create table if not exists public.auth_sessions (
  id uuid primary key default gen_random_uuid(),
  auth_id varchar not null,
  refresh_token_hash text not null unique,
  previous_refresh_token_hash text unique,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create index if not exists auth_sessions_auth_id_idx on public.auth_sessions (auth_id)
  where revoked_at is null;

alter table public.auth_sessions enable row level security;

do $$
begin
  if to_regclass('auth.refresh_tokens') is not null then
    insert into public.auth_sessions (id, auth_id, refresh_token_hash, created_at, expires_at)
    select distinct on (token.session_id)
      token.session_id,
      token.user_id,
      encode(sha256(convert_to(token.token, 'UTF8')), 'hex'),
      token.created_at,
      now() + interval '30 days'
    from auth.refresh_tokens token
    where not token.revoked
      and token.session_id is not null
      and token.user_id is not null
    order by token.session_id, token.id desc
    on conflict (id) do update
      set refresh_token_hash = excluded.refresh_token_hash,
          expires_at = excluded.expires_at
      where public.auth_sessions.rotated_at is null
        and public.auth_sessions.revoked_at is null;
  end if;
end
$$;

commit;
