# TESTING_ENV.md

How to set up a testing environment for wat2do v2. Written with an
opinion: there are three layers of "test env" that get conflated, and
each has a different setup cost. Pick what you actually need.

| Layer | What it isolates | Setup cost | Round-trip |
|---|---|---|---|
| **A. Unit + service tests (pytest)** | No DB at all — `fake_sb` mocks PostgREST chains | Free, already works | seconds |
| **B. Local integration stack** | Real Postgres + Auth + Storage, isolated per dev via Docker | One-time Docker install + `supabase start` | seconds–minutes |
| **C. Remote testing project** | A separate Supabase cloud project just for tests | One-time account setup | minutes (cloud round-trip) |

Most teams want all three. This doc covers each layer, plus the CI
plumbing that ties them together.

## Status of each layer in this repo today

- **Layer A (unit/service)** — ✅ Already in place. 586 backend tests
  pass. Test fixtures in `backend/tests/conftest.py` and
  `backend/tests/services/conftest.py` give every service a
  `fake_sb` + `patch_sb` pair so no real DB is needed.
- **Layer B (local stack)** — ⚠️ Half-baked. `backend/supabase/` has
  the migration timeline, but no one's run `supabase start` against it.
  Docker on the maintainer's machine is currently broken (`colima`
  VM startup fails on Apple Virtualization). The plumbing works on
  any machine with a healthy Docker daemon.
- **Layer C (remote test project)** — ✅ Already exists. The Supabase
  project `vgfwgjwahedyieaknkcd` (called `"test"` in the dashboard,
  West US Oregon) is what `backend/.env`'s `DATABASE_URL` points at.
  All 7 migrations from the deploy-readiness PR have been applied to
  it; 32 seed events are loaded.

---

## Layer A — Unit + service tests (already works)

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                    # 586 passing
pytest tests/services/wat2do/ -v   # focused on the scraping pipeline
```

**What this catches:** filter typos (`.eq("user_id", …)` drifting to
`.eq("owner_id", …)`), Pydantic validation regressions, the
shape-of-arguments-to-Supabase chain. **What it doesn't catch:**
real RLS, real cascade behavior, real PostgREST quirks (1000-row cap,
`.in_()` URL length), real Auth tokens.

---

## Layer B — Local integration stack (recommended for engineers)

Requires Docker. The maintainer's Mac currently can't run `colima`
(Apple Virtualization framework error); use Docker Desktop instead, or
fix the colima install via `colima delete && colima start --vm-type
qemu`.

```bash
# 1. Start the local Supabase stack (Postgres + Auth + Storage + Studio)
cd backend
supabase start
# This prints API URL, anon key, service-role key, JWT secret. Copy them
# into a separate .env.local file:
cat > .env.local <<EOF
SUPABASE_URL=$(supabase status -o env --override-name api.url SUPABASE_URL | grep SUPABASE_URL | cut -d= -f2-)
SUPABASE_KEY=$(supabase status -o env --override-name auth.anon_key SUPABASE_KEY | grep SUPABASE_KEY | cut -d= -f2-)
SUPABASE_SECRET_KEY=$(supabase status -o env --override-name auth.service_role_key SUPABASE_SECRET_KEY | grep SUPABASE_SECRET_KEY | cut -d= -f2-)
SUPABASE_JWT_SECRET=$(supabase status -o env --override-name auth.jwt_secret SUPABASE_JWT_SECRET | grep SUPABASE_JWT_SECRET | cut -d= -f2-)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
COOKIE_SECURE=false
ENVIRONMENT=development
EOF

# 2. Apply migrations to the local DB
supabase db push --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# 3. Seed the local DB (the existing seeds module covers events/clubs)
.venv/bin/python -c "from seeds.events import seed; seed()"

# 4. Boot the backend pointed at local
set -a && source .env.local && set +a
uvicorn main:app --reload --port 8000

# 5. (separate shell) frontend
cd ../frontend
echo "VITE_API_URL=http://localhost:8000" > .env.local
npm install
npm run dev
```

**What this catches:** RLS, FK cascade, PostgREST quirks, real Auth
flows (sign up creates a real user; verification emails go to
Inbucket at `http://127.0.0.1:54324`). **Stops being useful when:**
you're testing migrations against pre-existing prod-shaped data —
that's Layer C.

### Tear-down
```bash
supabase stop --no-backup       # discards the local DB
supabase stop                   # snapshots before stopping
```

---

## Layer C — Remote testing project (already exists; document it)

The `"test"` Supabase project (`vgfwgjwahedyieaknkcd`) IS the remote
testing env. **It is not v1 (`bug-free-octo-spork`).** Don't apply
migrations to v1's project from this codebase.

### Connecting

`backend/.env` already points at this project. To use it:
```bash
cd backend
set -a && source .env && set +a
supabase migration list --db-url "$DATABASE_URL"   # see what's applied
supabase db push --db-url "$DATABASE_URL"          # apply pending migrations
```

### Resetting after a destructive test
The "test" project is shared — anyone running tests against it can
trample data. To reset:
```bash
# Take a snapshot before resetting
pg_dump --no-owner --no-acl "$DATABASE_URL" > /tmp/test-snapshot.sql

# Wipe data tables (preserve schema)
psql "$DATABASE_URL" <<SQL
TRUNCATE
  public.event_dates, public.events, public.clubs,
  public.user_saved_events, public.user_interactions,
  public.user_recommendations, public.scrape_runs
RESTART IDENTITY CASCADE;
-- preserve users + auth.users by NOT touching them
SQL

# Re-seed
cd backend && .venv/bin/python -c "from seeds.events import seed; seed()"
```

### What was last left in the test project
After the deploy-readiness PR was verified end-to-end (PR #7),
the project sits at: 32 events / 29 event_dates / 7 clubs / 108 users.
A backup of pre-migration state lives at
`/tmp/wat2do-backup-20260428-134125/` on the maintainer's machine.

---

## CI plumbing — what runs on every PR

A `.github/workflows/test.yml` workflow should run Layer A on every
PR. Optional: extend with Layer B once a `supabase start`-friendly
runner is available.

### Minimal CI config to land

```yaml
# .github/workflows/test.yml
name: Test

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - name: Cache pip
        uses: actions/cache@v4
        with:
          path: ~/.cache/pip
          key: ${{ runner.os }}-pip-${{ hashFiles('backend/requirements.txt') }}
      - name: Install
        working-directory: backend
        run: pip install -r requirements.txt
      - name: pytest
        working-directory: backend
        env:
          # fake_sb tests don't need a real Supabase; placeholders keep
          # the Settings model happy at import time.
          SUPABASE_URL: https://example.supabase.co
          SUPABASE_KEY: x
          SUPABASE_SECRET_KEY: x
        run: pytest -q

  frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: frontend/package-lock.json
      - name: Install
        working-directory: frontend
        run: npm ci
      - name: Type-check
        working-directory: frontend
        run: npx tsc -b
      - name: Build
        working-directory: frontend
        run: npm run build
```

### Optional: integration tests against a Layer-C project

Add a second job that runs migrations + a Puppeteer smoke against the
"test" project. Risk: every PR's CI run hits the same project —
parallel PRs trample each other. Mitigate via either:
1. A workflow concurrency group (`concurrency: { group: integration,
   cancel-in-progress: false }`) so only one runs at a time.
2. A scheduled (nightly) job rather than per-PR.
3. A throwaway-per-PR project via the Supabase Management API
   (paid plans only).

For now: **don't run integration tests in PR CI**. Run them manually
via `gh workflow run` after the PR merges. The Layer-A tests + the
local Layer-B stack catch most regressions.

---

## Puppeteer smoke — keep but version-control

The Puppeteer driver I used during the live verification round lives
at `/tmp/wat2do-puppet/smoke.js` on the maintainer's machine — should
be moved into the repo at `frontend/tests/e2e/smoke.js` (or similar)
so anyone can run it. Tests:

1. Homepage HTTP 200.
2. `/` shows event cards from live DB.
3. Click event card → `EventDetailsModal` opens.
4. `/clubs` renders.
5. `/about` renders.
6. Backend public endpoints respond.
7. `GET /qr/` unauthenticated → 401.

Run via:
```bash
cd frontend/tests/e2e
npm install puppeteer
node smoke.js
```

Future additions worth writing:
- Sign-up flow against Inbucket (Layer B only — Inbucket lets the
  test read the verification email).
- Multi-occurrence event detail page renders all dates.
- Submit-event form serialization (after the FE is updated to send
  `occurrences: [...]` per Phase 8).

---

## Operational test playbook (post-merge, pre-deploy)

Once PR #7 merges to `main`:

1. **Trigger big-scrape dry-run:**
   ```bash
   gh workflow run big-scrape.yml \
     -f school='University of Waterloo' \
     -f limit=10 -f cutoff_days=4 -f dry_run=true
   ```
   Verify the workflow succeeds and prints
   `[DRY-RUN] University of Waterloo: 10 handle(s), N post(s) fetched, …`.

2. **Verify QR admin lockdown live** (after the FE is deployed
   somewhere with real auth):
   ```bash
   curl -i -H "Authorization: Bearer <USER_JWT>"  https://api.wat2do.app/qr/   # 403
   curl -i -H "Authorization: Bearer <ADMIN_JWT>" https://api.wat2do.app/qr/   # 200
   curl -i                                         https://api.wat2do.app/qr/   # 401
   ```

3. **Verify multi-occurrence end-to-end** by calling the API after a
   real scrape lands a multi-date event:
   ```bash
   # find a multi-occurrence event
   psql "$DATABASE_URL" -t -c "
     SELECT event_id FROM event_dates
     GROUP BY event_id HAVING count(*) > 1 LIMIT 1
   "
   # GET that event — should return one EventResponse with N occurrences
   curl -s "https://api.wat2do.app/events/<id>" | jq '.occurrences | length'
   ```

4. **Verify CASCADE on deletion:**
   ```bash
   psql "$DATABASE_URL" -t -c "DELETE FROM events WHERE id=<id>"
   psql "$DATABASE_URL" -t -c "SELECT count(*) FROM event_dates WHERE event_id=<id>"
   # expect 0
   ```

---

## Summary — what to do next, in order

1. **Land** PR #7 (already verified end-to-end against the test project).
2. **Add** `.github/workflows/test.yml` (the YAML above).
3. **Move** the Puppeteer smoke into the repo.
4. **Decide**: Layer B local stack (needs a working Docker on the dev
   machine) vs. Layer C remote testing project (already works; just
   document the reset script in this file).
5. **(Optional)** Spin up a separate Supabase project for CI
   integration tests so the "test" project doesn't get trampled by
   parallel runs.

Honest take: 90% of the value is in steps 1 + 2. The local stack
(step 4) only matters when you're rebuilding the schema or testing
auth/email flows offline.
