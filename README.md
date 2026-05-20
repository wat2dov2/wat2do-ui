# wat2do-v2

## Frontend startup

```bash
cd frontend
npm install
npm run dev
```

## Backend startup

### macOS/Linux

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
.venv/bin/python -m uvicorn main:app --reload
```

### Windows (PowerShell)

```powershell
cd backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
.venv\Scripts\python -m uvicorn main:app --reload
```

## Integrations setup

See `docs/integrations.md` for OAuth secret acquisition and integration environment setup.

## Database (Supabase CLI)

All schema lives in `backend/supabase/migrations/` — the Supabase CLI owns
everything (no Alembic, no custom Python runner). The schema dir sits
under `backend/` so a new feature's migration + code changes land in one
top-level directory.

### Prereqs

```bash
brew install supabase/tap/supabase
supabase login            # opens browser; one-time per machine
```

`backend/.env` has `DATABASE_URL` pointing at the session pooler (port
5432) — used only by the Supabase CLI / psql. The FastAPI runtime talks to
Supabase over HTTPS (PostgREST) and never touches this URL.

### Daily workflow

Run every command from inside `backend/` so the CLI finds `./supabase/`
and picks up the `DATABASE_URL` from `.env` automatically.

```bash
cd backend

# Create a new migration (writes to backend/supabase/migrations/)
supabase migration new add_widgets

# Apply pending migrations to the remote DB
supabase db push --db-url "$DATABASE_URL"

# See what's applied vs pending
supabase migration list --db-url "$DATABASE_URL"

# Local dev: spin up a full local stack (Postgres + Studio + Auth + Storage)
# and replay all migrations into it
supabase start
supabase db reset          # rebuild local from scratch
```

### Fresh env bootstrap

A new Supabase project reaches the current schema by running, from
inside `backend/`,
`supabase db push --include-all --db-url "$DATABASE_URL"`. Every migration
is idempotent, so partial runs can be retried without damage.
