-- A rejected account the school's Instagram account still follows waits in 'unfollow'
-- until the emulator unfollows it, then becomes 'rejected'. unfollowed_at counts the
-- day's unfollows, which share the follow allowance.

begin;

alter table public.instagram_follow_candidates
  drop constraint if exists instagram_follow_candidates_status_check;

alter table public.instagram_follow_candidates
  add constraint instagram_follow_candidates_status_check
  check (status in ('pending', 'approved', 'rejected', 'followed', 'unfollow'));

alter table public.instagram_follow_candidates
  add column if not exists unfollowed_at timestamptz;

commit;
