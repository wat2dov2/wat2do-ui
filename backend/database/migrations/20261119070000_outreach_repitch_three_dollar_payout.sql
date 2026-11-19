-- The club payout per eligible check-in went from $4 to $3 (controlbox/club_payouts.json
-- rate_cents), and pitches offer it as {{payout_per_scan}}, so every fit lead not
-- contacted yet is judged and pitched again with the new amount; a lead already
-- contacted keeps the text it was sent.
UPDATE public.outreach_leads SET pitch_fit = NULL, pitch_reason = NULL, pitch_script = NULL,
    pitch_email_subject = NULL, pitch_email_body = NULL, pitched_at = NULL
WHERE status = 'new' AND pitch_fit AND pitch_script IS NOT NULL;
