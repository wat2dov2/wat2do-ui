--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: adjust_credits(uuid, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.adjust_credits(p_user_id uuid, p_amount integer, p_default_balance integer DEFAULT 100) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_new_balance INTEGER;
BEGIN
    -- Ensure the row exists first.
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    IF p_amount >= 0 THEN
        -- Addition: always succeeds.
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_id = p_user_id
        RETURNING balance INTO v_new_balance;
    ELSE
        -- Deduction: atomic check-and-subtract.
        -- Only updates if balance >= |p_amount|, preventing negative balances.
        UPDATE user_credits
        SET balance = balance + p_amount,
            updated_at = now()
        WHERE user_id = p_user_id
          AND balance >= abs(p_amount)
        RETURNING balance INTO v_new_balance;

        -- If no row was updated, the user has insufficient credits.
        IF v_new_balance IS NULL THEN
            RETURN -1;
        END IF;
    END IF;

    RETURN v_new_balance;
END;
$$;


--
-- Name: ensure_user_credits(uuid, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_user_credits(p_user_id uuid, p_default_balance integer DEFAULT 100) RETURNS integer
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_balance INTEGER;
BEGIN
    SELECT balance INTO v_balance
    FROM user_credits
    WHERE user_id = p_user_id;

    IF NOT FOUND THEN
        INSERT INTO user_credits (user_id, balance)
        VALUES (p_user_id, p_default_balance)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING balance INTO v_balance;

        -- If the INSERT hit a conflict (concurrent insert), read the existing row.
        IF v_balance IS NULL THEN
            SELECT balance INTO v_balance
            FROM user_credits
            WHERE user_id = p_user_id;
        END IF;
    END IF;

    RETURN v_balance;
END;
$$;


--
-- Name: get_ab_test_ctr(character varying); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_ab_test_ctr(p_experiment_name character varying) RETURNS TABLE(variant character varying, impressions bigint, clicks bigint)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
    SELECT
        a.variant,
        COUNT(*) FILTER (WHERE a.event_type = 'impression') AS impressions,
        COUNT(*) FILTER (WHERE a.event_type = 'click')      AS clicks
    FROM ab_test_events a
    WHERE a.experiment_name = p_experiment_name
    GROUP BY a.variant
    ORDER BY a.variant;
$$;


--
-- Name: promote_event(uuid, integer, character varying, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.promote_event(p_user_id uuid, p_event_id integer, p_package character varying, p_credits_cost integer, p_duration_days integer, p_default_balance integer DEFAULT 100) RETURNS TABLE(promotion_id uuid, new_balance integer, start_date timestamp with time zone, end_date timestamp with time zone, created_at timestamp with time zone)
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
DECLARE
    v_existing       RECORD;
    v_new_balance    INTEGER;
    v_promo_id       UUID;
    v_start          TIMESTAMPTZ;
    v_end            TIMESTAMPTZ;
    v_current_balance INTEGER;
BEGIN
    -- Guard: credits_cost must be non-negative.
    IF p_credits_cost < 0 THEN
        RAISE EXCEPTION 'credits_cost must be non-negative'
            USING ERRCODE = 'P0001';
    END IF;

    -- ── Idempotency: return existing active promotion if present ────
    -- Lock the row (FOR UPDATE) to prevent a concurrent call from
    -- slipping past the check before we finish inserting.
    SELECT ep.id, ep.start_date AS sd, ep.end_date AS ed, ep.created_at AS ca
    INTO v_existing
    FROM event_promotions ep
    WHERE ep.user_id  = p_user_id
      AND ep.event_id = p_event_id
      AND ep.end_date > now()
    ORDER BY ep.end_date DESC
    LIMIT 1
    FOR UPDATE;

    IF FOUND THEN
        -- Active promotion already exists.  Return it without charging.
        -- Fetch the current balance so the caller gets a consistent view.
        SELECT uc.balance INTO v_current_balance
        FROM user_credits uc
        WHERE uc.user_id = p_user_id;

        IF v_current_balance IS NULL THEN
            v_current_balance := p_default_balance;
        END IF;

        RETURN QUERY
            SELECT v_existing.id,
                   v_current_balance,
                   v_existing.sd,
                   v_existing.ed,
                   v_existing.ca;
        RETURN;
    END IF;

    -- ── No active promotion — proceed with creation ─────────────────

    -- Ensure the credits row exists.
    PERFORM ensure_user_credits(p_user_id, p_default_balance);

    -- Atomic deduction: only succeeds if balance is sufficient.
    UPDATE user_credits
    SET balance = balance - p_credits_cost,
        updated_at = now()
    WHERE user_id = p_user_id
      AND balance >= p_credits_cost
    RETURNING balance INTO v_new_balance;

    IF v_new_balance IS NULL THEN
        RAISE EXCEPTION 'insufficient_credits'
            USING ERRCODE = 'P0001';
    END IF;

    -- Insert the promotion in the same transaction.
    v_promo_id := gen_random_uuid();
    v_start    := now();
    v_end      := now() + (p_duration_days || ' days')::INTERVAL;

    INSERT INTO event_promotions (id, user_id, event_id, package, credits_spent, start_date, end_date)
    VALUES (v_promo_id, p_user_id, p_event_id, p_package, p_credits_cost, v_start, v_end);

    RETURN QUERY
        SELECT v_promo_id,
               v_new_balance,
               v_start,
               v_end,
               v_start;  -- created_at = start_date for new rows
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: ab_test_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ab_test_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_id integer,
    variant character varying(32) NOT NULL,
    event_type character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    experiment_name character varying(64) NOT NULL
);


--
-- Name: club_integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.club_integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    club_id integer NOT NULL,
    platform character varying(32) NOT NULL,
    connected boolean DEFAULT false NOT NULL,
    name text,
    last_sync timestamp with time zone,
    server_id text,
    server_name text,
    channel_id text,
    channel_name text,
    handle text,
    group_id text,
    group_name text,
    page_id text,
    page_name text,
    connection_type character varying(16),
    extra jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: clubs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.clubs (
    id integer NOT NULL,
    club_name character varying(500) NOT NULL,
    categories jsonb,
    club_page character varying(500),
    ig character varying(255),
    discord character varying(255),
    club_type character varying(100) NOT NULL,
    logo_url character varying(1024),
    created_by text
);


--
-- Name: clubs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.clubs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: clubs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.clubs_id_seq OWNED BY public.clubs.id;


--
-- Name: event_promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_promotions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    package character varying(32) NOT NULL,
    credits_spent integer NOT NULL,
    start_date timestamp with time zone DEFAULT now() NOT NULL,
    end_date timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_event_promotions_credits_non_negative CHECK ((credits_spent >= 0)),
    CONSTRAINT chk_event_promotions_date_range CHECK ((end_date > start_date))
);


--
-- Name: event_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.event_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_data jsonb NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    rejection_reason text,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    reviewed_at timestamp with time zone
);


--
-- Name: events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.events (
    id integer NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    location character varying(500) NOT NULL,
    dtstart_utc timestamp with time zone,
    dtend_utc timestamp with time zone,
    price double precision,
    food jsonb,
    registration boolean DEFAULT false NOT NULL,
    source_image_url character varying(1024),
    club_type character varying(100),
    school character varying(255),
    source_url character varying(1024),
    category character varying(100),
    organization character varying(255) NOT NULL,
    ig_handle character varying(255),
    discord_handle character varying(255),
    x_handle character varying(255),
    tiktok_handle character varying(255),
    fb_handle character varying(255),
    other_handle character varying(255),
    display_handle character varying(255),
    added_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by text
);


--
-- Name: events_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.events_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: events_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.events_id_seq OWNED BY public.events.id;


--
-- Name: qr_code_scans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_code_scans (
    id uuid NOT NULL,
    qr_code_id character varying(64) NOT NULL,
    scanned_at timestamp with time zone DEFAULT now(),
    user_id character varying(255),
    session_id character varying(255) NOT NULL,
    conversion_actions jsonb DEFAULT '[]'::jsonb,
    user_agent character varying(512)
);


--
-- Name: qr_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qr_codes (
    id character varying(64) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    destination_type character varying(32) NOT NULL,
    destination_id character varying(512),
    filters jsonb,
    created_at timestamp with time zone DEFAULT now(),
    created_by character varying(255) NOT NULL,
    is_active boolean DEFAULT true,
    image_url character varying(1024),
    latitude double precision DEFAULT '0'::double precision,
    longitude double precision DEFAULT '0'::double precision
);


--
-- Name: reported_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reported_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    event_id integer NOT NULL,
    user_id uuid NOT NULL,
    reason text NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone
);


--
-- Name: user_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_credits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance integer DEFAULT 100 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_user_credits_balance_non_negative CHECK ((balance >= 0))
);


--
-- Name: user_interactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_interactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    session_id character varying(255) NOT NULL,
    event_id integer NOT NULL,
    interaction_type character varying(32) NOT NULL,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_recommendations (
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    rank integer NOT NULL,
    predicted_score double precision NOT NULL,
    reason character varying(255),
    computed_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_saved_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_saved_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    event_id integer NOT NULL,
    saved_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    supabase_auth_id character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    username character varying(100),
    full_name character varying(255),
    avatar_url character varying(512),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    faculty character varying(255),
    school character varying(255),
    interests jsonb,
    is_first_year boolean DEFAULT false NOT NULL,
    role text DEFAULT 'user'::text NOT NULL
);


--
-- Name: clubs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs ALTER COLUMN id SET DEFAULT nextval('public.clubs_id_seq'::regclass);


--
-- Name: events id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events ALTER COLUMN id SET DEFAULT nextval('public.events_id_seq'::regclass);


--
-- Name: ab_test_events ab_test_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT ab_test_events_pkey PRIMARY KEY (id);


--
-- Name: club_integrations club_integrations_club_id_platform_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_integrations
    ADD CONSTRAINT club_integrations_club_id_platform_key UNIQUE (club_id, platform);


--
-- Name: club_integrations club_integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_integrations
    ADD CONSTRAINT club_integrations_pkey PRIMARY KEY (id);


--
-- Name: clubs clubs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.clubs
    ADD CONSTRAINT clubs_pkey PRIMARY KEY (id);


--
-- Name: event_promotions event_promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_promotions
    ADD CONSTRAINT event_promotions_pkey PRIMARY KEY (id);


--
-- Name: event_submissions event_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_submissions
    ADD CONSTRAINT event_submissions_pkey PRIMARY KEY (id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (id);


--
-- Name: qr_code_scans qr_code_scans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_code_scans
    ADD CONSTRAINT qr_code_scans_pkey PRIMARY KEY (id);


--
-- Name: qr_codes qr_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_codes
    ADD CONSTRAINT qr_codes_pkey PRIMARY KEY (id);


--
-- Name: reported_events reported_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reported_events
    ADD CONSTRAINT reported_events_pkey PRIMARY KEY (id);


--
-- Name: user_credits user_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_pkey PRIMARY KEY (id);


--
-- Name: user_credits user_credits_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT user_credits_user_id_key UNIQUE (user_id);


--
-- Name: user_interactions user_interactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT user_interactions_pkey PRIMARY KEY (id);


--
-- Name: user_recommendations user_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendations
    ADD CONSTRAINT user_recommendations_pkey PRIMARY KEY (user_id, event_id);


--
-- Name: user_saved_events user_saved_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_events
    ADD CONSTRAINT user_saved_events_pkey PRIMARY KEY (id);


--
-- Name: user_saved_events user_saved_events_user_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_events
    ADD CONSTRAINT user_saved_events_user_id_event_id_key UNIQUE (user_id, event_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_club_integrations_club_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_integrations_club_id ON public.club_integrations USING btree (club_id);


--
-- Name: idx_club_integrations_connected; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_integrations_connected ON public.club_integrations USING btree (connected);


--
-- Name: idx_club_integrations_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_club_integrations_platform ON public.club_integrations USING btree (platform);


--
-- Name: idx_clubs_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_clubs_created_by ON public.clubs USING btree (created_by);


--
-- Name: idx_event_promotions_end_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_promotions_end_date ON public.event_promotions USING btree (end_date);


--
-- Name: idx_event_promotions_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_promotions_event_id ON public.event_promotions USING btree (event_id);


--
-- Name: idx_event_promotions_user_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_promotions_user_event ON public.event_promotions USING btree (user_id, event_id);


--
-- Name: idx_event_promotions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_promotions_user_id ON public.event_promotions USING btree (user_id);


--
-- Name: idx_event_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_submissions_status ON public.event_submissions USING btree (status);


--
-- Name: idx_event_submissions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_event_submissions_user_id ON public.event_submissions USING btree (user_id);


--
-- Name: idx_events_created_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_events_created_by ON public.events USING btree (created_by);


--
-- Name: idx_reported_events_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reported_events_event_id ON public.reported_events USING btree (event_id);


--
-- Name: idx_reported_events_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reported_events_status ON public.reported_events USING btree (status);


--
-- Name: idx_user_credits_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_user_credits_user_id ON public.user_credits USING btree (user_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: ix_ab_test_events_experiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ab_test_events_experiment ON public.ab_test_events USING btree (experiment_name, variant, event_type);


--
-- Name: ix_ab_test_events_variant; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_ab_test_events_variant ON public.ab_test_events USING btree (variant);


--
-- Name: ix_qr_code_scans_qr_code_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_qr_code_scans_qr_code_id ON public.qr_code_scans USING btree (qr_code_id);


--
-- Name: ix_user_interactions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_interactions_created_at ON public.user_interactions USING btree (created_at);


--
-- Name: ix_user_interactions_event_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_interactions_event_id ON public.user_interactions USING btree (event_id);


--
-- Name: ix_user_interactions_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_interactions_user_created ON public.user_interactions USING btree (user_id, created_at DESC);


--
-- Name: ix_user_interactions_user_event; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_interactions_user_event ON public.user_interactions USING btree (user_id, event_id);


--
-- Name: ix_user_recommendations_user_rank; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_recommendations_user_rank ON public.user_recommendations USING btree (user_id, rank);


--
-- Name: ix_user_saved_events_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ix_user_saved_events_user_id ON public.user_saved_events USING btree (user_id);


--
-- Name: ix_users_supabase_auth_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ix_users_supabase_auth_id ON public.users USING btree (supabase_auth_id);


--
-- Name: club_integrations club_integrations_club_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.club_integrations
    ADD CONSTRAINT club_integrations_club_id_fkey FOREIGN KEY (club_id) REFERENCES public.clubs(id) ON DELETE CASCADE;


--
-- Name: ab_test_events fk_ab_test_events_event_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT fk_ab_test_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE SET NULL;


--
-- Name: ab_test_events fk_ab_test_events_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ab_test_events
    ADD CONSTRAINT fk_ab_test_events_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: event_promotions fk_event_promotions_event_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_promotions
    ADD CONSTRAINT fk_event_promotions_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: event_promotions fk_event_promotions_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.event_promotions
    ADD CONSTRAINT fk_event_promotions_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_credits fk_user_credits_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_credits
    ADD CONSTRAINT fk_user_credits_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_interactions fk_user_interactions_event_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT fk_user_interactions_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: user_interactions fk_user_interactions_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_interactions
    ADD CONSTRAINT fk_user_interactions_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_recommendations fk_user_recommendations_event_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendations
    ADD CONSTRAINT fk_user_recommendations_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: user_recommendations fk_user_recommendations_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_recommendations
    ADD CONSTRAINT fk_user_recommendations_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_saved_events fk_user_saved_events_event_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_events
    ADD CONSTRAINT fk_user_saved_events_event_id FOREIGN KEY (event_id) REFERENCES public.events(id) ON DELETE CASCADE;


--
-- Name: user_saved_events fk_user_saved_events_user_id; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_saved_events
    ADD CONSTRAINT fk_user_saved_events_user_id FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: qr_code_scans qr_code_scans_qr_code_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qr_code_scans
    ADD CONSTRAINT qr_code_scans_qr_code_id_fkey FOREIGN KEY (qr_code_id) REFERENCES public.qr_codes(id) ON DELETE CASCADE;


--
-- Name: ab_test_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ab_test_events ENABLE ROW LEVEL SECURITY;

-- Name: club_integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.club_integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: clubs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;

--
-- Name: event_promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: event_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.event_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_code_scans; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qr_code_scans ENABLE ROW LEVEL SECURITY;

--
-- Name: qr_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qr_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: reported_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reported_events ENABLE ROW LEVEL SECURITY;

-- Name: user_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: user_interactions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_interactions ENABLE ROW LEVEL SECURITY;

--
-- Name: user_recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: user_saved_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_saved_events ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--
