BEGIN;

-- Delivery is independent of the import claim and browser execution state.
-- A new local queue generation can recover records delivered to a lost queue.
ALTER TABLE public.instagram_notification_media
    ADD COLUMN IF NOT EXISTS browser_delivery_generation uuid;
ALTER TABLE public.instagram_publish_batches
    ADD COLUMN IF NOT EXISTS browser_delivery_generation uuid,
    ADD COLUMN IF NOT EXISTS browser_delivery_sources jsonb;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'instagram_publish_batches_browser_delivery_sources_check'
          AND conrelid = 'public.instagram_publish_batches'::regclass
    ) THEN
        ALTER TABLE public.instagram_publish_batches
            ADD CONSTRAINT instagram_publish_batches_browser_delivery_sources_check
            CHECK (
                (browser_delivery_sources IS NULL OR jsonb_typeof(browser_delivery_sources) = 'array')
                AND (browser_delivery_generation IS NULL OR browser_delivery_sources IS NOT NULL)
            );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.preserve_instagram_browser_sources()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF OLD.browser_delivery_sources IS NOT NULL
       AND NEW.browser_delivery_sources IS DISTINCT FROM OLD.browser_delivery_sources THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Instagram browser sources are immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS preserve_instagram_browser_sources
    ON public.instagram_publish_batches;
CREATE TRIGGER preserve_instagram_browser_sources
BEFORE UPDATE OF browser_delivery_sources ON public.instagram_publish_batches
FOR EACH ROW
EXECUTE FUNCTION public.preserve_instagram_browser_sources();

-- Source selection commits before queue admission; delivery generation commits after it.
-- A row lock makes overlapping collectors use the first immutable selection.
CREATE OR REPLACE FUNCTION public.freeze_instagram_browser_sources(
    p_batch_id uuid,
    p_sources jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_sources jsonb;
BEGIN
    IF p_sources IS NULL OR jsonb_typeof(p_sources) <> 'array' THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Instagram browser source selection must be an array';
    END IF;

    SELECT browser_delivery_sources
    INTO v_sources
    FROM public.instagram_publish_batches
    WHERE id = p_batch_id AND status = 'published'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Instagram browser source batch is not published';
    END IF;

    IF v_sources IS NULL THEN
        UPDATE public.instagram_publish_batches
        SET browser_delivery_sources = p_sources
        WHERE id = p_batch_id;
        v_sources := p_sources;
    END IF;

    RETURN v_sources;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_instagram_browser_sources()
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.freeze_instagram_browser_sources(uuid, jsonb)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.freeze_instagram_browser_sources(uuid, jsonb)
    TO service_role;

CREATE INDEX IF NOT EXISTS instagram_notification_media_browser_delivery_idx
    ON public.instagram_notification_media (browser_delivery_generation, created_at, id)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS instagram_publish_batches_browser_delivery_idx
    ON public.instagram_publish_batches (browser_delivery_generation, published_at, id)
    WHERE status = 'published';

-- Keep the initial no-backfill boundary across local SQLite database recreation.
CREATE TABLE IF NOT EXISTS public.instagram_browser_source_state (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    activated_at timestamptz NOT NULL
);

ALTER TABLE public.instagram_browser_source_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.instagram_browser_source_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.instagram_browser_source_state TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_instagram_browser_source(p_activated_at timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_activated_at timestamptz;
BEGIN
    IF p_activated_at IS NULL THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            MESSAGE = 'Instagram browser source activation is required';
    END IF;

    INSERT INTO public.instagram_browser_source_state AS stored (id, activated_at)
    VALUES (true, p_activated_at)
    ON CONFLICT (id) DO UPDATE
        SET activated_at = LEAST(stored.activated_at, EXCLUDED.activated_at)
    RETURNING activated_at INTO v_activated_at;

    RETURN v_activated_at;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_instagram_browser_source(timestamptz)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_instagram_browser_source(timestamptz)
    TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
