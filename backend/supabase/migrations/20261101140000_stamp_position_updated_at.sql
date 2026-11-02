-- Keep positions.updated_at current on every edit so the card's "Updated" badge is
-- accurate. The live ingestion agent edits positions with plain SQL that never sets
-- updated_at; this stamps it. An explicit updated_at write (the reviewed-positions
-- RPC sets a monotonic value) is left untouched, so the two never fight.
CREATE OR REPLACE FUNCTION public.stamp_position_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
    IF NEW.updated_at IS NOT DISTINCT FROM OLD.updated_at THEN
        NEW.updated_at := now();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_position_updated_at ON public.positions;
CREATE TRIGGER stamp_position_updated_at BEFORE UPDATE ON public.positions
    FOR EACH ROW EXECUTE FUNCTION public.stamp_position_updated_at();
