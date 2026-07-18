begin;

create table public.commons_curators (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint commons_curators_normalized_email_check
    check (email = lower(btrim(email)) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);

create type public.commons_submission_source as enum ('form', 'seed', 'wat2do');
create type public.commons_submission_status as enum ('pending', 'approved', 'rejected');

create table public.commons_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  upload_path text not null unique,
  finalize_token_hash text not null,
  original_name text not null,
  claimed_mime_type text not null,
  claimed_size bigint not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  processing_at timestamptz,
  consumed_at timestamptz,
  requested_submission_id uuid,
  constraint commons_upload_sessions_path_check
    check (upload_path ~ '^[a-f0-9-]+\.(jpg|png|webp)$'),
  constraint commons_upload_sessions_token_hash_check
    check (finalize_token_hash ~ '^[a-f0-9]{64}$'),
  constraint commons_upload_sessions_original_name_check
    check (char_length(original_name) between 1 and 255),
  constraint commons_upload_sessions_mime_type_check
    check (claimed_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint commons_upload_sessions_size_check
    check (claimed_size between 1 and 10485760),
  constraint commons_upload_sessions_expiry_check
    check (expires_at > created_at),
  constraint commons_upload_sessions_consumption_check
    check (consumed_at is null or requested_submission_id is not null)
);

create table public.commons_submissions (
  id uuid primary key default gen_random_uuid(),
  source public.commons_submission_source not null default 'form',
  status public.commons_submission_status not null default 'pending',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  version bigint not null default 1,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  submitter_email text,
  event jsonb not null,
  upload_session_id uuid unique references public.commons_upload_sessions(id) on delete set null,
  cover_image_path text,
  cover_image_name text,
  badge_color text not null default '#b9f543',
  post jsonb not null,
  constraint commons_submissions_event_object_check
    check (jsonb_typeof(event) = 'object'),
  constraint commons_submissions_post_object_check
    check (jsonb_typeof(post) = 'object'),
  constraint commons_submissions_cover_path_check
    check (cover_image_path is null or cover_image_path ~ '^[a-f0-9-]+\.webp$'),
  constraint commons_submissions_badge_color_check
    check (badge_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint commons_submissions_version_check
    check (version >= 1),
  constraint commons_submissions_review_metadata_check
    check (
      (status = 'pending' and reviewed_at is null and reviewed_by is null)
      or (status in ('approved', 'rejected') and reviewed_at is not null)
    )
);

create index commons_submissions_status_submitted_at_idx
  on public.commons_submissions (status, submitted_at desc, id desc);

create index commons_upload_sessions_expiry_idx
  on public.commons_upload_sessions (expires_at)
  where consumed_at is null;

create table public.commons_rate_limits (
  bucket text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 1,
  primary key (bucket, key_hash),
  constraint commons_rate_limits_bucket_check
    check (bucket ~ '^[a-z0-9-]{1,64}$'),
  constraint commons_rate_limits_key_hash_check
    check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint commons_rate_limits_request_count_check
    check (request_count >= 1)
);

create index commons_rate_limits_window_idx
  on public.commons_rate_limits (window_started_at);

create function public.set_commons_submission_update_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'upload_session_id') = (to_jsonb(old) - 'upload_session_id') then
    return new;
  end if;

  new.updated_at := clock_timestamp();
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger commons_submissions_update_metadata
before update on public.commons_submissions
for each row execute function public.set_commons_submission_update_metadata();

create function public.consume_commons_rate_limit(
  p_bucket text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rate_limit_row public.commons_rate_limits%rowtype;
  window_interval interval;
  request_time timestamptz := statement_timestamp();
begin
  if p_limit < 1 or p_window_seconds < 1 then
    raise exception 'Rate limit and window must be positive.';
  end if;

  window_interval := make_interval(secs => p_window_seconds);

  insert into public.commons_rate_limits (
    bucket,
    key_hash,
    window_started_at,
    request_count
  )
  values (p_bucket, p_key_hash, request_time, 1)
  on conflict on constraint commons_rate_limits_pkey do update
  set
    window_started_at = case
      when public.commons_rate_limits.window_started_at + window_interval <= request_time
        then request_time
      else public.commons_rate_limits.window_started_at
    end,
    request_count = case
      when public.commons_rate_limits.window_started_at + window_interval <= request_time
        then 1
      else least(public.commons_rate_limits.request_count + 1, p_limit + 1)
    end
  returning * into rate_limit_row;

  allowed := rate_limit_row.request_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(extract(epoch from (
        rate_limit_row.window_started_at + window_interval - request_time
      )))::integer
    )
  end;
  return next;
end;
$$;

create function public.claim_commons_upload_session(
  p_upload_id uuid,
  p_finalize_token_hash text,
  p_submission_id uuid,
  p_processing_lease_seconds integer
)
returns setof public.commons_upload_sessions
language sql
security definer
set search_path = ''
as $$
  update public.commons_upload_sessions as session
  set
    processing_at = statement_timestamp(),
    requested_submission_id = coalesce(session.requested_submission_id, p_submission_id)
  where session.id = p_upload_id
    and session.finalize_token_hash = p_finalize_token_hash
    and session.expires_at > statement_timestamp()
    and session.consumed_at is null
    and (
      session.requested_submission_id is null
      or session.requested_submission_id = p_submission_id
    )
    and (
      session.processing_at is null
      or session.processing_at < statement_timestamp() - make_interval(secs => p_processing_lease_seconds)
    )
  returning session.*;
$$;

create function public.recover_commons_submission_finalize_replay(
  p_upload_id uuid,
  p_finalize_token_hash text,
  p_submission_id uuid,
  p_submitter_email text,
  p_event jsonb,
  p_post jsonb
)
returns table (upload_path text, recovered boolean)
language sql
security definer
set search_path = ''
as $$
  with matching_session as materialized (
    select session.id, session.upload_path
    from public.commons_upload_sessions as session
    join public.commons_submissions as submission
      on submission.upload_session_id = session.id
    where session.id = p_upload_id
      and session.finalize_token_hash = p_finalize_token_hash
      and session.requested_submission_id = p_submission_id
      and submission.id = p_submission_id
      and submission.source = 'form'
      and submission.submitter_email = p_submitter_email
      and submission.event = p_event
      and submission.post = p_post
  ),
  recovered_session as (
    update public.commons_upload_sessions as session
    set
      consumed_at = coalesce(session.consumed_at, statement_timestamp()),
      processing_at = null
    from matching_session
    where session.id = matching_session.id
      and (session.consumed_at is null or session.processing_at is not null)
    returning session.id
  )
  select
    matching_session.upload_path,
    exists (
      select 1
      from recovered_session
      where recovered_session.id = matching_session.id
    )
  from matching_session;
$$;

alter table public.commons_curators enable row level security;
alter table public.commons_upload_sessions enable row level security;
alter table public.commons_submissions enable row level security;
alter table public.commons_rate_limits enable row level security;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public grant usage, select on sequences to service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

create policy commons_curators_auth_hook_select
  on public.commons_curators
  for select
  to supabase_auth_admin
  using (true);

grant usage on schema public to supabase_auth_admin;
grant select on table public.commons_curators to supabase_auth_admin;

create function public.hook_restrict_commons_curators(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  candidate_email text;
begin
  candidate_email := lower(btrim(event->'user'->>'email'));

  if candidate_email is not null and exists (
    select 1
    from public.commons_curators
    where email = candidate_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This email is not authorized for curator access.'
    )
  );
end;
$$;

grant execute on function public.hook_restrict_commons_curators(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_commons_curators(jsonb) from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'commons-event-image-quarantine',
    'commons-event-image-quarantine',
    false,
    10485760,
    array['image/jpeg', 'image/png', 'image/webp']
  ),
  (
    'commons-event-images',
    'commons-event-images',
    false,
    10485760,
    array['image/webp']
  )
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into public.commons_curators (email)
values ('tonyqiu12345@gmail.com')
on conflict (email) do nothing;

commit;
