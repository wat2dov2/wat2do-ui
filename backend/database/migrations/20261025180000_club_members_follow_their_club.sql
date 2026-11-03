-- Club members always follow their own club; the app adds the follow when it adds a member.
-- Backfill the follow for everyone who is already a member.
INSERT INTO public.user_saved_clubs (user_id, club_id)
SELECT member.user_id, member.club_id
FROM public.club_members member
ON CONFLICT (user_id, club_id) DO NOTHING;
