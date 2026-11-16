-- The event an approved submission published, so its submitter's profile
-- can open it (`/users/me/submissions`). Approval sets it in the same
-- transaction that publishes the event; deleting the event clears it.

ALTER TABLE public.event_submissions
    ADD COLUMN IF NOT EXISTS event_id integer
        CONSTRAINT fk_event_submissions_event_id
        REFERENCES public.events(id) ON DELETE SET NULL;

-- Submissions approved before this column existed: the event of the same
-- title and club that approval published moments before it was recorded.
UPDATE public.event_submissions es
SET event_id = (
    SELECT e.id FROM public.events e
    WHERE e.title = es.event_data->>'title'
      AND e.club_id::text = es.event_data->>'club_id'
      AND e.added_at BETWEEN es.reviewed_at - interval '1 minute' AND es.reviewed_at
    ORDER BY e.added_at DESC
    LIMIT 1
)
WHERE es.status = 'approved' AND es.event_id IS NULL AND es.reviewed_at IS NOT NULL;

COMMENT ON COLUMN public.event_submissions.event_id IS
    'The event this submission published when it was approved.';
