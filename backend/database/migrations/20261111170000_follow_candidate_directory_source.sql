-- Accounts a school's official club directory lists come in through the club directory
-- agents as source 'directory', pending, so the follow scorer decides them.
-- found_via names the directory instead of followed accounts.

begin;

alter table public.instagram_follow_candidates
  drop constraint if exists instagram_follow_candidates_source_check;

alter table public.instagram_follow_candidates
  add constraint instagram_follow_candidates_source_check
  check (source in ('crawl', 'club', 'import', 'directory'));

commit;
