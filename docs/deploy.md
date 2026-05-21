# Deploy

The single doc you need to ship wat2do v2. Replaces the seven journal-style
docs the deploy-readiness PR originally produced (audit, security audit,
deployment notes, todo, e2e test report, testing env, scripts audit) — those
were artefacts of building this PR, not reference material a deployer needs.

## State at the time of writing

- All 7 Supabase migrations applied to the v2 project (`vgfwgjwahedyieaknkcd`,
  the "test" project — **not v1**'s `bug-free-octo-spork`).
- Backend test suite: **586 passing**.
- Frontend `npm run build`: **succeeds**.
- GH repo secrets configured on `tonyqiu123/wat2do-ui`:
  `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`,
  `OPENAI_API_KEY`, `APIFY_API_TOKEN`.
- Live verification: 32 events, 29 event_dates rows backfilled, 7 clubs,
  108 users. View `events_listing` has `security_invoker=true`. CASCADE
  FK on `event_dates.event_id → events.id` confirmed.

## Required env vars

### Backend container (AWS ECS task definition or local `.env`)

| Variable | Source | Purpose |
|---|---|---|
| `SUPABASE_URL` | Project URL | `https://<ref>.supabase.co` |
| `SUPABASE_KEY` | Anon key | Used only by the auth client |
| `SUPABASE_SECRET_KEY` | Service-role key | Bypasses RLS. Backend exits at startup if unset. |
| `DATABASE_URL` | Pooler URL | Migrations only. FastAPI runtime does NOT read it. |
| `OPENAI_API_KEY` | OpenAI dashboard | Vision-based event extraction (`services/wat2do/extractor.py`). |
| `APIFY_API_TOKEN` | Apify console | Instagram scraper (`services/wat2do/instagram_scraper.py`). Pipeline raises at startup if missing. |
| `OPENAI_EXTRACTION_MODEL` | Optional | Defaults to `gpt-4o-mini`. |
| `CORS_ORIGINS` | JSON list | e.g. `["https://wat2do.app"]`. Wildcard `*` is rejected at startup. |
| `COOKIE_SECURE` | Bool | Defaults `true` (HTTPS-only refresh cookie). Set `false` only for local HTTP dev. |
| `COOKIE_DOMAIN` | String | Empty for local; the production domain otherwise. |
| `TRUSTED_PROXIES` | JSON list | `/32` IPs the backend trusts for `X-Forwarded-For`. Default loopback only. |
| `ENVIRONMENT` | `production` / `development` | Disables `/docs`, `/redoc`, `/openapi.json` in prod. |
| `FRONTEND_URL` | Public app URL | Used as the Supabase password-reset redirect base. Defaults to `http://localhost:5173`. |
| `EMAIL_PROVIDER` | `resend` / empty | Empty = log-only dry-run. |
| `EMAIL_PROVIDER_API_KEY` | Provider key | Required when `EMAIL_PROVIDER` is set. |
| `EMAIL_FROM` | RFC 5322 string | Notifications "From" header. |

### Frontend (Vercel project env)

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL, e.g. `https://api.wat2do.app` |
| `VITE_MAPBOX_TOKEN` | Mapbox GL token. Optional unless map view enabled. |
| `VITE_CLARITY_PROJECT_ID` | Microsoft Clarity. Optional. |

### GitHub Actions secrets

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend key used by the daily new-events email workflow. |
| `RESEND_FROM_EMAIL` | Verified sender email; workflow formats it as `wat2do <email>`. |

## What still needs to happen

Ordered by dependency.

### 0. Prereqs in your control

- [ ] **Wire frontend submit-event flow to Phase 8's API contract.** The
      form still serializes `dtstart_utc` / `dtend_utc` at the top level;
      the API now requires `occurrences: [...]`. Submission path will
      422 until that's fixed.
- [ ] **Confirm exact email sub-domains** for UPenn / NYU / Columbia /
      MIT in `backend/core/allowed_emails.py`. The current list uses
      defensible defaults; NYU and Columbia have many sub-domains
      (engineering, dental, etc.) — sign up with one real email per
      school to surface gaps.

### 1. AWS — backend

- [ ] Create ECR repo + push image: `aws ecr create-repository --repository-name wat2do-backend`, then `docker build`, tag, push.
- [ ] IAM roles: `wat2doExecutionRole` (trust `ecs-tasks.amazonaws.com`, attach `AmazonECSTaskExecutionRolePolicy`) + `wat2doTaskRole` (empty inline policy — app uses Supabase Storage, no AWS access needed).
- [ ] ECS cluster (Fargate): `aws ecs create-cluster --cluster-name wat2do-prod`.
- [ ] Task definition: `awsvpc` network mode, port 8000, env from Secrets Manager / Parameter Store, CloudWatch log group.
- [ ] Security groups: `wat2do-alb-sg` (80/443 from `0.0.0.0/0`), `wat2do-task-sg` (8000 in from ALB SG only).
- [ ] ALB + ACM cert (`api.wat2do.app`) + Route 53 A-alias. Health check on `/health`.
- [ ] ECS service against the cluster + task def + target group.

### 2. Vercel — frontend

- [ ] Import `tonyqiu123/wat2do-ui`, root directory `frontend`, framework preset Vite.
- [ ] Env vars: `VITE_API_URL = https://api.wat2do.app`, optional `VITE_MAPBOX_TOKEN`, `VITE_CLARITY_PROJECT_ID`.
- [ ] Custom domains: `wat2do.app` (apex) + `www.wat2do.app`.

### 3. Operational verifications

- [ ] `gh workflow run big-scrape.yml -f school='University of Waterloo' -f limit=10 -f cutoff_days=4 -f dry_run=true` — succeeds with `[DRY-RUN]` summary line.
- [ ] `gh workflow run big-scrape.yml ... -f dry_run=false` — multi-occurrence post produces 1 events row + N event_dates rows.
- [ ] `curl -s https://api.wat2do.app/health` — `{"status":"ok"}`.
- [ ] QR admin lockdown:
  ```bash
  curl -i -H "Authorization: Bearer <USER_JWT>"  https://api.wat2do.app/qr/   # 403
  curl -i -H "Authorization: Bearer <ADMIN_JWT>" https://api.wat2do.app/qr/   # 200
  curl -i                                         https://api.wat2do.app/qr/   # 401
  ```
- [ ] `docker build .` from `backend/` succeeds locally before any push (Docker Desktop required; `colima` was failing on the maintainer's Mac).

## Local dev

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
set -a && source .env && set +a
uvicorn main:app --reload --port 8000

# Frontend (separate shell)
cd frontend
npm install
npm run dev   # :5173, points at http://localhost:8000 by default
```

`.env` belongs in `backend/.env`; `frontend/.env.local` overrides
`VITE_API_URL` if needed.

## Tests

```bash
# Unit + service tests (no DB needed; fake_sb mocks Supabase)
cd backend && pytest -q                          # 586 passing

# Frontend type-check + build
cd frontend && npx tsc -b                        # 0 errors
cd frontend && npm run build                     # production bundle
```

For real-DB integration tests, point `DATABASE_URL` at the "test"
Supabase project and run pytest as above. To bring up an isolated local
stack instead: `cd backend && supabase start` (requires Docker), then
`supabase db push --db-url "postgresql://postgres:postgres@127.0.0.1:54322/postgres"`,
then seed: `.venv/bin/python -c "from seeds.events import seed; seed()"`.

A Puppeteer browser smoke (homepage, events list, detail modal,
`/clubs`, `/about`, public API, QR 401 lockdown) was used during PR
verification — port it into the repo when you want it in CI.

## Things that are NOT in this PR

- A CI workflow that runs pytest on PRs. Recommended:
  `.github/workflows/test.yml` running `pytest -q` (backend) and
  `npx tsc -b && npm run build` (frontend) on every PR.
- A separate Supabase project for CI integration tests. The current
  "test" project is shared — parallel CI runs would trample. Either
  serialize via workflow concurrency, or use the Supabase Management
  API to spin up throwaway projects per PR.
- Auth flow + submit-event flow tested via Puppeteer. Auth needs
  Inbucket (Layer-B local stack only). Submit needs the FE update
  above.

## Reset script for the shared test project

If parallel testers trample data:

```bash
cd backend
set -a && source .env && set +a

# Snapshot first
pg_dump --no-owner --no-acl "$DATABASE_URL" > /tmp/test-snapshot.sql

# Wipe data (preserve auth + schema)
psql "$DATABASE_URL" <<SQL
TRUNCATE
  public.event_dates, public.events, public.clubs,
  public.user_saved_events, public.user_interactions,
  public.user_recommendations, public.workflow_runs
RESTART IDENTITY CASCADE;
SQL

# Re-seed
.venv/bin/python -c "from seeds.events import seed; seed()"
```
