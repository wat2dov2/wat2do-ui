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

See `INTEGRATIONS_README.md` for OAuth secret acquisition and integration environment setup.

## Database (Supabase CLI)

All schema lives in `supabase/migrations/`. The Supabase CLI owns everything —
no Alembic, no custom Python runner.

### Prereqs

```bash
brew install supabase/tap/supabase
supabase login            # opens browser; one-time per machine
```

`backend/.env` has `DATABASE_URL` on port **6543** (transaction pooler) —
that's correct for the FastAPI runtime. For the Supabase CLI, swap the port
to **5432** (session pooler) — DDL can't run through the transaction pooler:

```bash
export MIGRATION_DB_URL="${DATABASE_URL/:6543/:5432}"
```

### Daily workflow

```bash
# Create a new migration
supabase migration new add_widgets

# Apply pending migrations to the remote DB
supabase db push --db-url "$MIGRATION_DB_URL"

# See what's applied vs pending
supabase migration list --db-url "$MIGRATION_DB_URL"

# Local dev: spin up a full local stack (Postgres + Studio + Auth + Storage)
# and replay all migrations into it
supabase start
supabase db reset          # rebuild local from scratch
```

### Fresh env bootstrap

A new Supabase project reaches the current schema by running
`supabase db push --include-all --db-url "$MIGRATION_DB_URL"`. Every migration
is idempotent, so partial runs can be retried without damage.

