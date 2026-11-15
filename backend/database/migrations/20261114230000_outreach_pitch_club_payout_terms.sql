-- Outreach pitches now offer the club payout per scanned student from
-- controlbox/club_payouts.json, link its terms page and read more naturally
-- (services/outreach/pitch_prompt.md, hooks.md), so every judged lead is judged
-- and pitched again.
UPDATE public.outreach_leads SET pitch_fit = NULL, pitch_reason = NULL, pitch_script = NULL,
    pitch_email_subject = NULL, pitch_email_body = NULL, pitched_at = NULL
WHERE pitch_fit IS NOT NULL;
