alter table public.events
  add column if not exists ingestion_source varchar(32) not null default 'manual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'events_ingestion_source_check'
  ) then
    alter table public.events
      add constraint events_ingestion_source_check
      check (ingestion_source in ('manual', 'submission', 'instagram_scraper', 'seed'));
  end if;
end
$$;

create table if not exists public.instagram_publish_batches (
  id uuid primary key default gen_random_uuid(),
  account_key varchar(100) not null,
  instagram_user_id varchar(64) not null,
  school varchar(255) not null,
  local_date date not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status varchar(32) not null default 'generating',
  caption text not null default '',
  cover_image_url varchar(2048),
  ai_model varchar(100),
  version integer not null default 1,
  error_message text,
  meta_cover_container_id varchar(100),
  meta_carousel_container_id varchar(100),
  meta_media_id varchar(100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint instagram_publish_batches_status_check
    check (
      status in (
        'generating',
        'ready_for_review',
        'publishing',
        'published',
        'empty',
        'failed'
      )
    ),
  constraint instagram_publish_batches_version_check check (version > 0),
  constraint instagram_publish_batches_window_check check (window_end > window_start),
  constraint instagram_publish_batches_account_date_key unique (account_key, local_date)
);

create table if not exists public.instagram_publish_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.instagram_publish_batches(id) on delete cascade,
  account_key varchar(100) not null,
  event_id integer not null references public.events(id) on delete restrict,
  position smallint,
  included boolean not null default true,
  event_snapshot jsonb not null,
  visual_score numeric(4, 2) not null,
  excitement_score numeric(4, 2) not null,
  audience_score numeric(4, 2) not null,
  timing_score numeric(4, 2) not null,
  overall_score numeric(4, 2) not null,
  ai_reason varchar(500) not null,
  cover_candidate boolean not null default false,
  asset_url varchar(2048) not null,
  meta_container_id varchar(100),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_publish_items_batch_event_key unique (batch_id, event_id),
  constraint instagram_publish_items_position_check
    check (
      (included and position between 1 and 9)
      or (not included and position is null)
    ),
  constraint instagram_publish_items_snapshot_check
    check (jsonb_typeof(event_snapshot) = 'object'),
  constraint instagram_publish_items_score_check
    check (
      visual_score between 0 and 10
      and excitement_score between 0 and 10
      and audience_score between 0 and 10
      and timing_score between 0 and 10
      and overall_score between 0 and 10
    )
);

create unique index if not exists instagram_publish_items_included_position_key
  on public.instagram_publish_items (batch_id, position)
  where included;

create unique index if not exists instagram_publish_items_published_event_key
  on public.instagram_publish_items (account_key, event_id)
  where published_at is not null;

create index if not exists instagram_publish_batches_status_date_idx
  on public.instagram_publish_batches (status, local_date desc, created_at desc);

create index if not exists instagram_publish_items_batch_position_idx
  on public.instagram_publish_items (batch_id, included desc, position);

alter table public.instagram_publish_batches enable row level security;
alter table public.instagram_publish_items enable row level security;

create or replace function public.update_instagram_publish_batch_draft(
  p_batch_id uuid,
  p_expected_version integer,
  p_caption text,
  p_item_ids uuid[],
  p_cover_image_url text
)
returns setof public.instagram_publish_batches
language plpgsql
security definer
set search_path = public
as $$
declare
  batch_row public.instagram_publish_batches%rowtype;
  selected_count integer;
begin
  select *
  into batch_row
  from public.instagram_publish_batches
  where id = p_batch_id
  for update;

  if batch_row.id is null then
    raise exception 'instagram publishing batch not found';
  end if;

  if batch_row.version <> p_expected_version then
    raise exception 'instagram publishing batch version conflict';
  end if;

  if batch_row.status not in ('ready_for_review', 'failed') then
    raise exception 'instagram publishing batch is not editable';
  end if;

  selected_count := coalesce(array_length(p_item_ids, 1), 0);
  if selected_count < 1 or selected_count > 9 then
    raise exception 'instagram publishing batch must contain between 1 and 9 event items';
  end if;

  if (
    select count(distinct item_id)
    from unnest(p_item_ids) as item_id
  ) <> selected_count then
    raise exception 'instagram publishing item ids must be unique';
  end if;

  if (
    select count(*)
    from public.instagram_publish_items
    where batch_id = p_batch_id
      and id = any(p_item_ids)
  ) <> selected_count then
    raise exception 'instagram publishing item does not belong to batch';
  end if;

  update public.instagram_publish_items
  set
    included = false,
    position = null,
    updated_at = now()
  where batch_id = p_batch_id;

  update public.instagram_publish_items as item
  set
    included = true,
    position = ordered.ordinality::smallint,
    updated_at = now()
  from unnest(p_item_ids) with ordinality as ordered(id, ordinality)
  where item.id = ordered.id
    and item.batch_id = p_batch_id;

  return query
  update public.instagram_publish_batches
  set
    caption = p_caption,
    cover_image_url = p_cover_image_url,
    status = 'ready_for_review',
    error_message = null,
    meta_cover_container_id = null,
    meta_carousel_container_id = null,
    meta_media_id = null,
    version = version + 1,
    updated_at = now()
  where id = p_batch_id
  returning *;
end;
$$;

revoke all on function public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  uuid[],
  text
) from public, anon, authenticated;

grant execute on function public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  uuid[],
  text
) to service_role;
