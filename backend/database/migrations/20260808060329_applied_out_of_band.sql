-- Recovered from production with `supabase db pull` on 2026-08-09.
--
-- This migration was originally applied directly to production. Keeping the
-- recovered statements at their original remote version makes a local reset
-- reproduce the production schema without inventing a second migration path.

ALTER TABLE public.workflow_runs DROP CONSTRAINT workflow_runs_pkey;

DROP INDEX IF EXISTS public.idx_events_category;
DROP INDEX IF EXISTS public.workflow_runs_pkey;

CREATE TABLE public.event_rsvps (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    status text NOT NULL DEFAULT 'going'::text,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.events
    ADD COLUMN association_affiliated boolean NOT NULL DEFAULT false,
    ADD COLUMN discord_handle character varying(255),
    ADD COLUMN dtend_utc timestamp with time zone,
    ADD COLUMN dtstart_utc timestamp with time zone,
    ADD COLUMN fb_handle character varying(255),
    ADD COLUMN other_handle character varying(255),
    ADD COLUMN tiktok_handle character varying(255),
    ADD COLUMN x_handle character varying(255);

ALTER TABLE public.organizations
    ADD COLUMN association_affiliated boolean NOT NULL DEFAULT false;

ALTER TABLE public.school_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX event_rsvps_pkey
    ON public.event_rsvps USING btree (id);
CREATE UNIQUE INDEX event_rsvps_user_id_event_id_key
    ON public.event_rsvps USING btree (user_id, event_id);
CREATE INDEX idx_event_rsvps_event_id
    ON public.event_rsvps USING btree (event_id);
CREATE INDEX idx_event_rsvps_user_id
    ON public.event_rsvps USING btree (user_id);
CREATE UNIQUE INDEX scrape_runs_pkey
    ON public.workflow_runs USING btree (id);

ALTER TABLE public.event_rsvps
    ADD CONSTRAINT event_rsvps_pkey PRIMARY KEY USING INDEX event_rsvps_pkey,
    ADD CONSTRAINT event_rsvps_event_id_fkey
        FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE
        NOT VALID,
    ADD CONSTRAINT event_rsvps_status_check
        CHECK (status = ANY (ARRAY['going'::text, 'checked_in'::text, 'cancelled'::text]))
        NOT VALID,
    ADD CONSTRAINT event_rsvps_user_id_event_id_key
        UNIQUE USING INDEX event_rsvps_user_id_event_id_key,
    ADD CONSTRAINT event_rsvps_user_id_fkey
        FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE
        NOT VALID;

ALTER TABLE public.workflow_runs
    ADD CONSTRAINT scrape_runs_pkey PRIMARY KEY USING INDEX scrape_runs_pkey;

ALTER TABLE public.event_rsvps
    VALIDATE CONSTRAINT event_rsvps_event_id_fkey;
ALTER TABLE public.event_rsvps
    VALIDATE CONSTRAINT event_rsvps_status_check;
ALTER TABLE public.event_rsvps
    VALIDATE CONSTRAINT event_rsvps_user_id_fkey;

SET check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.handle_update_timestamp()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  new.updated_at = now();
  return new;
END;
$function$;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE
    ON TABLE public.event_rsvps TO service_role;

CREATE TRIGGER update_event_rsvps_timestamp
BEFORE UPDATE ON public.event_rsvps
FOR EACH ROW EXECUTE FUNCTION public.handle_update_timestamp();
