-- Events now derive organization / club_type / school from their owning club
-- (see event_service._resolve_club_fields), so EventCreate no longer accepts
-- those fields and rejects them via extra="forbid". Pending submissions stored
-- under the old shape still carry them, which would fail validation on approve.
-- Strip the now-derived keys from the stored event_data of pending rows so
-- moderation can publish them without a back-compat shim.

UPDATE public.event_submissions
SET event_data = event_data - 'organization' - 'club_type' - 'school'
WHERE status = 'pending'
  AND (
      event_data ? 'organization'
      OR event_data ? 'club_type'
      OR event_data ? 'school'
  );
