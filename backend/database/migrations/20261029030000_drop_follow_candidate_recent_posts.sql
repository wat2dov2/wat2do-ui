-- The follow-candidate review UI no longer renders a candidate's recent posts: the
-- stored thumbnails were signed Instagram CDN links that expire after a few days, so a
-- reviewer now just opens the live profile. The scorer still reads the newest posts
-- from the live logged-out read at crawl time, and last_posted_at is kept, so nothing
-- reads this column any more. The code that stopped reading it shipped first (#145), so
-- dropping it now is safe for the running build.

begin;

alter table public.instagram_follow_candidates
  drop column if exists recent_posts;

commit;
