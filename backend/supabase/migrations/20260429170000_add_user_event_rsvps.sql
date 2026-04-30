-- Add user_event_rsvps table to capture "I'm Going" RSVPs.
-- Mirrors user_saved_events: a (user_id, event_id) pair with timestamp,
-- unique per (user, event), RLS enabled.

CREATE TABLE public.user_event_rsvps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    rsvped_at timestamp with time zone DEFAULT now()
);

ALTER TABLE ONLY public.user_event_rsvps
    ADD CONSTRAINT user_event_rsvps_pkey PRIMARY KEY (id);

ALTER TABLE ONLY public.user_event_rsvps
    ADD CONSTRAINT user_event_rsvps_user_id_event_id_key UNIQUE (user_id, event_id);

CREATE INDEX ix_user_event_rsvps_user_id ON public.user_event_rsvps USING btree (user_id);

ALTER TABLE ONLY public.user_event_rsvps
    ADD CONSTRAINT fk_user_event_rsvps_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.user_event_rsvps
    ADD CONSTRAINT fk_user_event_rsvps_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE public.user_event_rsvps ENABLE ROW LEVEL SECURITY;
