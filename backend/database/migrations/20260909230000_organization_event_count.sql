BEGIN;

-- PostgREST computed field: the displayed total and filter share this definition.
CREATE OR REPLACE FUNCTION public.event_count(public.organizations)
RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = ''
AS $$
    SELECT count(*) FROM public.events WHERE organization_id = ($1).id;
$$;

NOTIFY pgrst, 'reload schema';
COMMIT;
