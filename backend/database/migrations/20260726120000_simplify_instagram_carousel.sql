-- The events table is the carousel's only source of truth.
--
-- A publish batch now records the scrape run (window, school, account) plus the
-- copy an admin writes; its items record which events are on the carousel and
-- in what order. Slide images are not content: they are generated from event
-- data at publish time and handed straight to Meta, so nothing about them is
-- stored here. The AI curation scores go with them - they picked the initial
-- lineup and were never read again.

alter table public.instagram_publish_batches
  drop column if exists cover_image_url,
  drop column if exists meta_cover_container_id,
  drop column if exists meta_carousel_container_id;

-- Every stored item is on the carousel; removing a slide deletes its row.
delete from public.instagram_publish_items where included is false;

drop index if exists public.instagram_publish_items_included_position_key;
drop index if exists public.instagram_publish_items_batch_position_idx;

alter table public.instagram_publish_items
  drop constraint if exists instagram_publish_items_position_check,
  drop constraint if exists instagram_publish_items_snapshot_check,
  drop constraint if exists instagram_publish_items_score_check,
  drop column if exists included,
  drop column if exists event_snapshot,
  drop column if exists visual_score,
  drop column if exists excitement_score,
  drop column if exists audience_score,
  drop column if exists timing_score,
  drop column if exists overall_score,
  drop column if exists ai_reason,
  drop column if exists cover_candidate,
  drop column if exists asset_url,
  drop column if exists meta_container_id;

alter table public.instagram_publish_items
  alter column position set not null,
  add constraint instagram_publish_items_position_check check (position between 1 and 9);

create unique index if not exists instagram_publish_items_batch_position_key
  on public.instagram_publish_items (batch_id, position);

create index if not exists instagram_publish_items_batch_position_idx
  on public.instagram_publish_items (batch_id, position);

drop function if exists public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  text,
  uuid[],
  text
);

-- The editor saves the carousel it is holding: the events on it, in order.
create or replace function public.update_instagram_publish_batch_draft(
  p_batch_id uuid,
  p_expected_version integer,
  p_caption text,
  p_cover_body text,
  p_event_ids integer[]
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

  selected_count := coalesce(array_length(p_event_ids, 1), 0);
  if selected_count < 1 or selected_count > 9 then
    raise exception 'instagram publishing batch must contain between 1 and 9 event items';
  end if;

  if (
    select count(distinct event_id)
    from unnest(p_event_ids) as event_id
  ) <> selected_count then
    raise exception 'instagram publishing event ids must be unique';
  end if;

  -- An item carries nothing but its event and its place in the order, so the
  -- saved carousel simply replaces the stored one. Items only ever gain a
  -- published_at once the whole batch publishes, which also makes it
  -- uneditable, so this never discards publish history.
  delete from public.instagram_publish_items where batch_id = p_batch_id;

  insert into public.instagram_publish_items (
    batch_id,
    account_key,
    event_id,
    position
  )
  select
    p_batch_id,
    batch_row.account_key,
    ordered.event_id,
    ordered.ordinality::smallint
  from unnest(p_event_ids) with ordinality as ordered(event_id, ordinality);

  return query
  update public.instagram_publish_batches
  set
    caption = p_caption,
    cover_body = p_cover_body,
    status = 'ready_for_review',
    error_message = null,
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
  text,
  integer[]
) from public, anon, authenticated;

grant execute on function public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  text,
  integer[]
) to service_role;
