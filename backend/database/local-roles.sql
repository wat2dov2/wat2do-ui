-- Roles and default grants for the local development database only.
-- scripts/dev.py applies this before every migration run on the
-- docker-compose.dev.yml database; every statement is safe to repeat.
-- Production creates its own roles and grants with its own passwords.
--
-- The data API (PostgREST) logs in as authenticator, which holds no privileges
-- of its own, and switches to the role a request's token names. The backend's
-- token names service_role, which may use every table in public and bypasses
-- row-level security, as the backend's queries expect.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN BYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'authenticator') THEN
        CREATE ROLE authenticator LOGIN NOINHERIT;
    END IF;
END
$$;

-- Development-only password, matching PGRST_DB_URI in docker-compose.dev.yml.
ALTER ROLE authenticator PASSWORD 'authenticator';
GRANT service_role TO authenticator;

-- The baseline carries no grants, so tables, sequences and functions created
-- from here on are granted to service_role as they are created.
GRANT USAGE ON SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role;
