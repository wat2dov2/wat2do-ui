-- Outreach pitches now say what a claimed club gets today (services/outreach/pitch_prompt.md,
-- hooks.md): the verified check on its page, its card and every event it hosts, free QR
-- tickets turned on in the event's own form and scanned with a phone at the door, the
-- payout per check-in, who's going, and its team joining with "I'm a member". They no
-- longer say claimed clubs' events are shown first, which nothing does.
-- Every fit lead not contacted yet is judged and pitched again; a lead already contacted
-- keeps the text it was sent.
UPDATE public.outreach_leads SET pitch_fit = NULL, pitch_reason = NULL, pitch_script = NULL,
    pitch_email_subject = NULL, pitch_email_body = NULL, pitched_at = NULL
WHERE status = 'new' AND pitch_fit AND pitch_script IS NOT NULL;
