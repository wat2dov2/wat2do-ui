-- Each campus gets separate daily event and employer carousels.
begin;

alter table public.instagram_publish_batches
  add column if not exists batch_kind text not null default 'events';

alter table public.instagram_publish_batches
  drop constraint if exists instagram_publish_batches_account_date_key;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'instagram_publish_batches_kind_check') then
    alter table public.instagram_publish_batches
      add constraint instagram_publish_batches_kind_check
      check (batch_kind in ('events', 'employers_on_campus'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'instagram_publish_batches_account_date_kind_key') then
    alter table public.instagram_publish_batches
      add constraint instagram_publish_batches_account_date_kind_key
      unique (account_key, local_date, batch_kind);
  end if;
end
$$;

notify pgrst, 'reload schema';
commit;
