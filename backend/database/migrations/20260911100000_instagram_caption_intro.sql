alter table public.instagram_publish_batches add column caption_intro text not null default '';

drop function public.update_instagram_publish_batch_draft(uuid, integer, text, text, integer[]);

create or replace function public.update_instagram_publish_batch_draft(
  p_batch_id uuid,
  p_expected_version integer,
  p_caption text,
  p_caption_intro text,
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
  if selected_count < 1 then
    raise exception 'instagram publishing batch must contain at least one event item';
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
    ordered.ordinality::integer
  from unnest(p_event_ids) with ordinality as ordered(event_id, ordinality);

  return query
  update public.instagram_publish_batches
  set
    caption = p_caption,
    caption_intro = p_caption_intro,
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
  text,
  integer[]
) from public, anon, authenticated;

grant execute on function public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  text,
  text,
  integer[]
) to service_role;
