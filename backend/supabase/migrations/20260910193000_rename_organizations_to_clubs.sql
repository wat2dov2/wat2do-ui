-- Rename the domain in place. PostgreSQL retains row data, foreign-key targets,
-- grants, and policy dependencies when tables and columns are renamed.
DO $$
DECLARE
    item record;
BEGIN
    FOR item IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename LIKE '%organization%'
    LOOP
        EXECUTE format('ALTER TABLE public.%I RENAME TO %I',
            item.tablename, replace(item.tablename, 'organization', 'club'));
    END LOOP;

    FOR item IN
        SELECT table_name, column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name LIKE '%organization%'
    LOOP
        EXECUTE format('ALTER TABLE public.%I RENAME COLUMN %I TO %I',
            item.table_name, item.column_name,
            replace(item.column_name, 'organization', 'club'));
    END LOOP;

    FOR item IN
        SELECT c.conrelid::regclass AS relation, c.conname
        FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
        WHERE n.nspname = 'public' AND c.conname LIKE '%organization%'
    LOOP
        EXECUTE format('ALTER TABLE %s RENAME CONSTRAINT %I TO %I',
            item.relation, item.conname, replace(item.conname, 'organization', 'club'));
    END LOOP;

    FOR item IN
        SELECT c.relname, c.relkind FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname LIKE '%organization%'
            AND c.relkind IN ('i', 'S')
    LOOP
        EXECUTE format('ALTER %s public.%I RENAME TO %I',
            CASE item.relkind WHEN 'i' THEN 'INDEX' ELSE 'SEQUENCE' END,
            item.relname, replace(item.relname, 'organization', 'club'));
    END LOOP;

    FOR item IN
        SELECT t.tgrelid::regclass AS relation, t.tgname
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND NOT t.tgisinternal
            AND t.tgname LIKE '%organization%'
    LOOP
        EXECUTE format('ALTER TRIGGER %I ON %s RENAME TO %I',
            item.tgname, item.relation, replace(item.tgname, 'organization', 'club'));
    END LOOP;

    -- Rename functions first to retain trigger dependencies and grants.
    FOR item IN
        SELECT p.oid::regprocedure AS signature, p.proname
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname LIKE '%organization%'
    LOOP
        EXECUTE format('ALTER FUNCTION %s RENAME TO %I',
            item.signature, replace(item.proname, 'organization', 'club'));
    END LOOP;

    -- SQL/PLpgSQL bodies contain text identifiers and JSON contract keys that
    -- PostgreSQL does not rewrite automatically when columns are renamed.
    FOR item IN
        SELECT pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.prokind = 'f'
            AND p.prosrc LIKE '%organization%'
    LOOP
        EXECUTE replace(item.definition, 'organization', 'club');
    END LOOP;
END;
$$;

-- Pending submissions and saved QR filters must use the same wire keys as
-- current clients. Keep values (including names and external URLs) untouched.
CREATE FUNCTION pg_temp.rename_club_keys(value jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
BEGIN
    IF jsonb_typeof(value) = 'object' THEN
        RETURN (SELECT coalesce(jsonb_object_agg(
            replace(replace(key, 'organization', 'club'), 'Organization', 'Club'),
            pg_temp.rename_club_keys(val)), '{}'::jsonb)
            FROM jsonb_each(value) AS entries(key, val));
    ELSIF jsonb_typeof(value) = 'array' THEN
        RETURN (SELECT coalesce(jsonb_agg(pg_temp.rename_club_keys(val)), '[]'::jsonb)
            FROM jsonb_array_elements(value) AS entries(val));
    END IF;
    RETURN value;
END;
$$;

UPDATE public.event_submissions SET event_data = pg_temp.rename_club_keys(event_data);
UPDATE public.position_submissions SET position_data = pg_temp.rename_club_keys(position_data);
UPDATE public.qr_codes SET filters = pg_temp.rename_club_keys(filters) WHERE filters IS NOT NULL;
UPDATE public.user_interactions SET metadata = pg_temp.rename_club_keys(metadata) WHERE metadata IS NOT NULL;
UPDATE public.credit_transactions SET metadata = pg_temp.rename_club_keys(metadata) WHERE metadata IS NOT NULL;

NOTIFY pgrst, 'reload schema';
