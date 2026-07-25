-- Editable cover copy + admin-driven slide selection.
--
-- The carousel editor compiles the cover from the event slides the admin is
-- currently looking at, so the draft update now carries the cover body text and
-- the caller may hand back items it created itself (an admin adding an event to
-- the carousel), not only items the generator produced.

alter table public.instagram_publish_batches
  add column if not exists cover_body text not null default '';

drop function if exists public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  uuid[],
  text
);

create or replace function public.update_instagram_publish_batch_draft(
  p_batch_id uuid,
  p_expected_version integer,
  p_caption text,
  p_cover_body text,
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
    cover_body = p_cover_body,
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
  text,
  uuid[],
  text
) from public, anon, authenticated;

grant execute on function public.update_instagram_publish_batch_draft(
  uuid,
  integer,
  text,
  text,
  uuid[],
  text
) to service_role;
