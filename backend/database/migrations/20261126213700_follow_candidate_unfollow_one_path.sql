-- One way to stop following an account: whoever rejects a row (the scorer, an admin,
-- a script, a deleted club), the row waits in 'unfollow' while the school's
-- Instagram account may still follow it, so the emulator unfollows it first.
--
-- An account counts as followed when the row is 'followed', when a follow was tapped
-- (followed_at, set even when its bell step failed and the row stayed 'approved'), or
-- when the school account's own Following list last showed it (seen_following_at, set
-- by the follow crawl), unless an unfollow came after. 'unfollow' rows becoming
-- 'rejected' are the emulator finishing an unfollow and are left alone.
--
-- Deleting a club rejects its account's row (a school has one club per account,
-- clubs_school_handle_key), so the account is unfollowed with it.

BEGIN;

ALTER TABLE public.instagram_follow_candidates
    ADD COLUMN IF NOT EXISTS seen_following_at timestamptz;

CREATE OR REPLACE FUNCTION public.follow_candidate_unfollow_on_reject()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.status = 'rejected'
        AND OLD.status <> 'unfollow'
        AND (
            OLD.status = 'followed'
            OR greatest(OLD.followed_at, OLD.seen_following_at)
                > coalesce(OLD.unfollowed_at, '-infinity'::timestamptz)
        )
    THEN
        NEW.status := 'unfollow';
        NEW.follow_error := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS follow_candidate_unfollow_on_reject ON public.instagram_follow_candidates;
CREATE TRIGGER follow_candidate_unfollow_on_reject
BEFORE UPDATE OF status ON public.instagram_follow_candidates
FOR EACH ROW
EXECUTE FUNCTION public.follow_candidate_unfollow_on_reject();

CREATE OR REPLACE FUNCTION public.reject_deleted_club_follow()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF public.club_handle_key(OLD.ig) = '' THEN
        RETURN OLD;
    END IF;
    UPDATE public.instagram_follow_candidates AS c
    SET status = 'rejected',
        reason = 'Its club was deleted',
        decided_at = now(),
        updated_at = now()
    WHERE c.school_id = OLD.school_id
        AND public.club_handle_key(c.handle) = public.club_handle_key(OLD.ig)
        AND c.status IN ('pending', 'approved', 'followed');
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS reject_deleted_club_follow ON public.clubs;
CREATE TRIGGER reject_deleted_club_follow
AFTER DELETE ON public.clubs
FOR EACH ROW
EXECUTE FUNCTION public.reject_deleted_club_follow();

-- The data API learns about the new column.
NOTIFY pgrst, 'reload schema';

COMMIT;
