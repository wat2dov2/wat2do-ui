-- Paid tickets for club events, sold through each club's own Stripe Connect
-- Express account. Money never passes through Wat2Do: every charge is a direct
-- charge on the club's account. These tables record which club is connected,
-- what an event sells, which seats are held during checkout, and which tickets
-- were issued, checked in or refunded.

BEGIN;

-- Ticket prices and connected accounts follow the school's country.
ALTER TABLE public.schools ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT 'CA';
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schools_country_check') THEN
        ALTER TABLE public.schools
            ADD CONSTRAINT schools_country_check CHECK (country IN ('CA', 'US'));
    END IF;
END
$$;
UPDATE public.schools
SET country = 'US'
WHERE slug IN ('berkeley', 'columbia', 'cornell', 'mit', 'nyu', 'upenn', 'umich');

-- One Stripe Express account per club. A club never swaps accounts through the
-- app, so a member cannot redirect another member's payouts.
CREATE TABLE IF NOT EXISTS public.club_payment_accounts (
    club_id integer PRIMARY KEY REFERENCES public.clubs (id) ON DELETE RESTRICT,
    stripe_account_id text NOT NULL UNIQUE CHECK (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
    country text NOT NULL CHECK (country IN ('CA', 'US')),
    charges_enabled boolean NOT NULL DEFAULT false,
    payouts_enabled boolean NOT NULL DEFAULT false,
    details_submitted boolean NOT NULL DEFAULT false,
    requirements_due text[] NOT NULL DEFAULT '{}',
    connected_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- What a ticketed event sells. Capacity applies to each date of the event.
CREATE TABLE IF NOT EXISTS public.event_ticketing (
    event_id integer PRIMARY KEY REFERENCES public.events (id) ON DELETE CASCADE,
    price_cents integer NOT NULL CHECK (price_cents > 0),
    currency text NOT NULL CHECK (currency IN ('cad', 'usd')),
    capacity integer CHECK (capacity IS NULL OR capacity > 0),
    sales_paused boolean NOT NULL DEFAULT false,
    updated_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- One checkout. A pending order holds its seats until reserved_until, which
-- outlasts the Stripe Checkout session so a late payment still has its seats.
CREATE TABLE IF NOT EXISTS public.ticket_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id integer NOT NULL REFERENCES public.events (id) ON DELETE RESTRICT,
    event_date_id uuid NOT NULL,
    club_id integer NOT NULL REFERENCES public.clubs (id) ON DELETE RESTRICT,
    buyer_user_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
    buyer_email text NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_amount_cents integer NOT NULL CHECK (unit_amount_cents > 0),
    currency text NOT NULL CHECK (currency IN ('cad', 'usd')),
    status text NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'expired', 'failed')),
    stripe_account_id text NOT NULL,
    stripe_checkout_session_id text UNIQUE,
    stripe_payment_intent_id text,
    reserved_until timestamptz NOT NULL,
    paid_at timestamptz,
    confirmation_sent_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ticket_orders_event_date_fkey
        FOREIGN KEY (event_id, event_date_id)
        REFERENCES public.event_dates (event_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS ticket_orders_seats_idx
    ON public.ticket_orders (event_date_id, status, reserved_until);
CREATE INDEX IF NOT EXISTS ticket_orders_buyer_idx ON public.ticket_orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ticket_orders_event_idx ON public.ticket_orders (event_id);

-- One admission. The code is the secret printed in the ticket's QR code.
CREATE TABLE IF NOT EXISTS public.tickets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES public.ticket_orders (id) ON DELETE RESTRICT,
    event_id integer NOT NULL,
    event_date_id uuid NOT NULL,
    code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z2-7]{20,40}$'),
    status text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'refunded')),
    checked_in_at timestamptz,
    checked_in_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
    refunded_at timestamptz,
    refunded_by uuid REFERENCES public.users (id) ON DELETE SET NULL,
    stripe_refund_id text,
    -- A holder can ask the club for a refund once; the club refunds or declines it.
    refund_requested_at timestamptz,
    refund_request_note text CHECK (
        refund_request_note IS NULL OR length(refund_request_note) <= 500
    ),
    refund_declined_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tickets_event_date_fkey
        FOREIGN KEY (event_id, event_date_id)
        REFERENCES public.event_dates (event_id, id) ON DELETE RESTRICT,
    CONSTRAINT tickets_refund_recorded CHECK (
        (status = 'refunded') = (refunded_at IS NOT NULL)
    ),
    CONSTRAINT tickets_decline_follows_request CHECK (
        refund_declined_at IS NULL OR refund_requested_at IS NOT NULL
    )
);
CREATE INDEX IF NOT EXISTS tickets_event_date_idx ON public.tickets (event_date_id, status);
CREATE INDEX IF NOT EXISTS tickets_order_idx ON public.tickets (order_id);
CREATE INDEX IF NOT EXISTS tickets_event_idx ON public.tickets (event_id);

CREATE OR REPLACE FUNCTION public.touch_ticketing_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = clock_timestamp();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_club_payment_accounts_updated_at ON public.club_payment_accounts;
CREATE TRIGGER set_club_payment_accounts_updated_at
BEFORE UPDATE ON public.club_payment_accounts
FOR EACH ROW EXECUTE FUNCTION public.touch_ticketing_updated_at();
DROP TRIGGER IF EXISTS set_event_ticketing_updated_at ON public.event_ticketing;
CREATE TRIGGER set_event_ticketing_updated_at
BEFORE UPDATE ON public.event_ticketing
FOR EACH ROW EXECUTE FUNCTION public.touch_ticketing_updated_at();
DROP TRIGGER IF EXISTS set_ticket_orders_updated_at ON public.ticket_orders;
CREATE TRIGGER set_ticket_orders_updated_at
BEFORE UPDATE ON public.ticket_orders
FOR EACH ROW EXECUTE FUNCTION public.touch_ticketing_updated_at();

-- Seats one date still has: valid tickets plus live holds count against capacity.
CREATE OR REPLACE FUNCTION public.ticket_seats_taken(p_event_date_id uuid, p_now timestamptz)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT (
        SELECT count(*)::integer FROM public.tickets
        WHERE event_date_id = p_event_date_id AND status = 'valid'
    ) + (
        SELECT COALESCE(sum(quantity), 0)::integer FROM public.ticket_orders
        WHERE event_date_id = p_event_date_id AND status = 'pending' AND reserved_until > p_now
    );
$$;

-- Seats taken on every date of one event, for the public availability view.
CREATE OR REPLACE FUNCTION public.event_ticket_seats_taken(p_event_id integer, p_now timestamptz)
RETURNS TABLE (event_date_id uuid, seats_taken integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT event_date.id, public.ticket_seats_taken(event_date.id, p_now)
    FROM public.event_dates AS event_date
    WHERE event_date.event_id = p_event_id;
$$;

-- Hold seats for one checkout. The event's ticketing row is locked so two
-- buyers can never both take the last seat.
CREATE OR REPLACE FUNCTION public.reserve_ticket_order(
    p_order_id uuid,
    p_event_id integer,
    p_event_date_id uuid,
    p_buyer_user_id uuid,
    p_buyer_email text,
    p_quantity integer,
    p_reserved_until timestamptz,
    p_now timestamptz
)
RETURNS SETOF public.ticket_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticketing public.event_ticketing;
    v_event public.events;
    v_starts_at timestamptz;
    v_account public.club_payment_accounts;
BEGIN
    SELECT * INTO v_ticketing FROM public.event_ticketing WHERE event_id = p_event_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKETS_NOT_FOR_SALE';
    END IF;
    IF v_ticketing.sales_paused THEN
        RAISE EXCEPTION 'TICKET_SALES_PAUSED';
    END IF;

    SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
    IF v_event.cancelled THEN
        RAISE EXCEPTION 'EVENT_CANCELLED';
    END IF;
    IF v_event.club_id IS NULL THEN
        RAISE EXCEPTION 'TICKETS_NOT_FOR_SALE';
    END IF;

    SELECT dtstart_utc INTO v_starts_at
    FROM public.event_dates WHERE id = p_event_date_id AND event_id = p_event_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_DATE_NOT_FOUND';
    END IF;
    IF v_starts_at <= p_now THEN
        RAISE EXCEPTION 'TICKET_SALES_CLOSED';
    END IF;

    SELECT * INTO v_account FROM public.club_payment_accounts WHERE club_id = v_event.club_id;
    IF NOT FOUND OR NOT v_account.charges_enabled THEN
        RAISE EXCEPTION 'PAYOUTS_NOT_READY';
    END IF;

    IF v_ticketing.capacity IS NOT NULL
       AND public.ticket_seats_taken(p_event_date_id, p_now) + p_quantity > v_ticketing.capacity THEN
        RAISE EXCEPTION 'TICKETS_SOLD_OUT';
    END IF;

    RETURN QUERY
    INSERT INTO public.ticket_orders (
        id, event_id, event_date_id, club_id, buyer_user_id, buyer_email, quantity,
        unit_amount_cents, currency, stripe_account_id, reserved_until
    )
    VALUES (
        p_order_id, p_event_id, p_event_date_id, v_event.club_id, p_buyer_user_id, p_buyer_email,
        p_quantity, v_ticketing.price_cents, v_ticketing.currency, v_account.stripe_account_id,
        p_reserved_until
    )
    RETURNING *;
END;
$$;

-- Turn a paid checkout into tickets exactly once, however often Stripe
-- repeats the event. Returns true only for the call that issued them.
CREATE OR REPLACE FUNCTION public.fulfil_ticket_order(
    p_order_id uuid,
    p_checkout_session_id text,
    p_payment_intent_id text,
    p_codes text[],
    p_now timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order public.ticket_orders;
BEGIN
    SELECT * INTO v_order FROM public.ticket_orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'TICKET_ORDER_NOT_FOUND';
    END IF;
    IF v_order.status = 'paid' THEN
        RETURN false;
    END IF;
    IF v_order.stripe_checkout_session_id IS DISTINCT FROM p_checkout_session_id THEN
        RAISE EXCEPTION 'TICKET_ORDER_SESSION_MISMATCH';
    END IF;
    IF coalesce(array_length(p_codes, 1), 0) <> v_order.quantity THEN
        RAISE EXCEPTION 'TICKET_CODES_MISMATCH';
    END IF;

    UPDATE public.ticket_orders
    SET status = 'paid', paid_at = p_now, stripe_payment_intent_id = p_payment_intent_id
    WHERE id = p_order_id;

    INSERT INTO public.tickets (order_id, event_id, event_date_id, code)
    SELECT p_order_id, v_order.event_id, v_order.event_date_id, code
    FROM unnest(p_codes) AS code;
    RETURN true;
END;
$$;

-- The Instagram ingestion agent never edits an event a club sells tickets
-- for: the club owns its price, dates and details on Wat2Do.
CREATE OR REPLACE FUNCTION public.is_ticketed_event(p_event_id integer)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (SELECT 1 FROM public.event_ticketing WHERE event_id = p_event_id);
$$;

CREATE OR REPLACE FUNCTION public.skip_ingestion_writes_to_ticketed_events()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_event_id integer;
BEGIN
    IF current_user = 'wat2do_ingest_agent' THEN
        IF TG_TABLE_NAME = 'events' THEN
            v_event_id := OLD.id;
        ELSIF TG_OP = 'DELETE' THEN
            v_event_id := OLD.event_id;
        ELSE
            v_event_id := NEW.event_id;
        END IF;
        IF public.is_ticketed_event(v_event_id) THEN
            -- Skipping the row leaves the club's event exactly as the club set it.
            RETURN NULL;
        END IF;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS skip_ingestion_writes_to_ticketed_events ON public.events;
CREATE TRIGGER skip_ingestion_writes_to_ticketed_events
BEFORE UPDATE OR DELETE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.skip_ingestion_writes_to_ticketed_events();
DROP TRIGGER IF EXISTS skip_ingestion_writes_to_ticketed_events ON public.event_dates;
CREATE TRIGGER skip_ingestion_writes_to_ticketed_events
BEFORE INSERT OR UPDATE OR DELETE ON public.event_dates
FOR EACH ROW EXECUTE FUNCTION public.skip_ingestion_writes_to_ticketed_events();

ALTER TABLE public.club_payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_ticketing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_payment_accounts, public.event_ticketing, public.ticket_orders, public.tickets
    FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.club_payment_accounts, public.event_ticketing, public.ticket_orders, public.tickets
    TO service_role;

REVOKE ALL ON FUNCTION public.ticket_seats_taken(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_ticket_seats_taken(integer, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_ticket_seats_taken(integer, timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.reserve_ticket_order(uuid, integer, uuid, uuid, text, integer, timestamptz, timestamptz)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fulfil_ticket_order(uuid, text, text, text[], timestamptz)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_ticketed_event(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ticket_seats_taken(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_ticket_order(uuid, integer, uuid, uuid, text, integer, timestamptz, timestamptz)
    TO service_role;
GRANT EXECUTE ON FUNCTION public.fulfil_ticket_order(uuid, text, text, text[], timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_ticketed_event(integer) TO service_role, wat2do_ingest_agent;

COMMIT;

NOTIFY pgrst, 'reload schema';
