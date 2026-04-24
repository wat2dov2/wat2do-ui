-- Migration: add_notifications_log_table
-- Created: 2026-04-24
--
-- Send-log (not decision-log) for the notifications feature. Every row
-- represents one outbound send attempt; the UNIQUE constraint on
-- (user_id, notification_type, target_id, channel) is what makes the
-- worker safe to retry: a second attempt to send the same notification
-- fails at INSERT time with a unique-violation, and the worker knows to
-- drop the duplicate without re-sending.
--
-- Why this shape:
--   * target_id semantics vary by type (see notification_service):
--       morning_digest → YYYY-MM-DD      (one per user per day)
--       weekly_digest  → YYYY-Www        (one per user per ISO week)
--       event_change   → {event_id}:{change_hash}
--                                        (one per user per distinct change)
--     The UNIQUE constraint therefore means the right thing per type.
--   * status is terminal: pending | sent | failed. No attempt_count —
--     providers handle transient retries internally; a ``failed`` row
--     is a permanent failure that an operator investigates manually.
--   * changed_fields is populated for event_change only; stores the diff
--     as ``{field: {old, new}}`` so the email renderer is a pure function
--     of the log row and doesn't re-diff at send time.
--
-- Skips (user has no events today → no morning digest) are NOT logged.
-- The uniqueness constraint protects *sends*, not *decisions*; skip
-- observability goes to app logs, not rows.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + pg_constraint-guarded FKs
-- and partial index.

BEGIN;

-- 1. Table -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    notification_type text NOT NULL,
    target_id text NOT NULL,
    channel text NOT NULL DEFAULT 'email',
    status text NOT NULL,
    changed_fields jsonb,
    sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT notifications_log_status_check
        CHECK (status IN ('pending', 'sent', 'failed')),
    CONSTRAINT notifications_log_dedup_key
        UNIQUE (user_id, notification_type, target_id, channel)
);

-- 2. RLS ---------------------------------------------------------------
ALTER TABLE public.notifications_log ENABLE ROW LEVEL SECURITY;

-- 3. Foreign keys ------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_notifications_log_user_id'
    ) THEN
        ALTER TABLE public.notifications_log
            ADD CONSTRAINT fk_notifications_log_user_id
            FOREIGN KEY (user_id) REFERENCES public.users(id)
            ON DELETE CASCADE;
    END IF;
END$$;

-- 4. Indexes -----------------------------------------------------------
-- User-scoped reads (e.g. "which digests has this user received").
CREATE INDEX IF NOT EXISTS ix_notifications_log_user_type
    ON public.notifications_log (user_id, notification_type);

-- Worker's "what's stuck" query — partial index so we only carry the
-- tiny slice of rows that aren't already in a terminal state.
CREATE INDEX IF NOT EXISTS ix_notifications_log_pending
    ON public.notifications_log (created_at)
    WHERE status = 'pending';

COMMIT;
