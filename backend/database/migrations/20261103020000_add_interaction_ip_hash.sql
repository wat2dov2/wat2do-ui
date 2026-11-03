BEGIN;

-- Hashed client IP (keyed HMAC, same scheme as public.qr_code_scans.ip_hash) so a
-- flood of anonymous clicks can be capped per IP + event and traced afterwards,
-- without ever storing a raw IP address. NULL for interactions recorded before this
-- change and whenever the client IP is unavailable.
ALTER TABLE public.user_interactions ADD COLUMN IF NOT EXISTS ip_hash text;
ALTER TABLE public.position_interactions ADD COLUMN IF NOT EXISTS ip_hash text;

-- Supports the per-(ip_hash, event/position) anonymous-click burst check, which reads
-- a single IP's recent clicks within the dedup window before accepting more.
CREATE INDEX IF NOT EXISTS user_interactions_ip_event_idx
    ON public.user_interactions (ip_hash, event_id, created_at)
    WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS position_interactions_ip_position_idx
    ON public.position_interactions (ip_hash, position_id, created_at)
    WHERE ip_hash IS NOT NULL;

COMMIT;
