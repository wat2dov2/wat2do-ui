-- Apply after the application release that removes paid promotions and credits.
-- Historical migrations remain intact; fresh databases apply this cleanup last.
BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.promote_event(uuid, integer, character varying, integer, integer, integer);
DROP FUNCTION IF EXISTS public.adjust_credits(uuid, integer, integer);
DROP FUNCTION IF EXISTS public.ensure_user_credits(uuid, integer);

DROP TABLE IF EXISTS public.event_promotions;
DROP TABLE IF EXISTS public.credit_transactions;
DROP TABLE IF EXISTS public.user_credits;

COMMIT;
