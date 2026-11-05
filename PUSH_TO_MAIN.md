# Push to Main

**Read `AGENTS.md` first.**
This file is the mandatory pre-push gate for any agent (or human) landing work on `main`.
It mirrors [`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml) exactly - if these checks pass locally, CI should pass on push.

Do **not** push to `main` until every step below is green.

---

## 1. Workspace hygiene

```bash
git status
```

- Resolve or discard unrelated local changes before committing.
- Do **not** commit secrets (`.env`, credentials), Playwright artifacts, or local-only files.
- Keep generated output in ignored directories such as `frontend/test-results/`.

Optional codebase health scan (fix major issues; do not block on pre-existing complexity debt):

```bash
npx fallow
```

---

## 2. Workflow and backend checks

From repo root, validate the notification and CI workflows with the same pinned actionlint release used in CI:

```bash
bash scripts/check-notification-workflow.sh
```

This checks GitHub expression contexts before a workflow can be rejected without starting jobs.
The script downloads a small official release archive and verifies its pinned SHA256.

From repo root:

```bash
cd backend
pip install --prefer-binary -r requirements-dev.txt   # skip if venv already set up
```

Run **all four** commands. Each must exit 0:

```bash
ruff format --check .
ruff check .
mypy .
ENVIRONMENT=testing \
  DATA_API_URL=https://data.example.test \
  DATA_API_KEY=test-service-key \
  pytest -q
```

Then the Rust checks, from repo root (install Rust with rustup and cmake with Homebrew first):

```bash
cd rust
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
```

`cargo test` fails while `backend/core/rust_openapi.json` lags the Rust routes; regenerate it with `cargo run --bin wat2do-api -- openapi > ../backend/core/rust_openapi.json` and then `npm run generate-types` in `frontend/`.
Pull requests also build the backend image (Rust stage included) and smoke-test `wat2do-api` with the Python app behind it; Docker is not needed locally.

---

## 3. Frontend checks

From repo root:

```bash
cd frontend
npm ci   # skip if node_modules already matches package-lock.json
```

Run **all five** commands. Each must exit 0:

```bash
npm run lint
npm run audit:i18n
npm run type-check
npm test
npm run build
```

---

## 4. Database migrations

**Production's database is PostgreSQL 17 on the Mac mini, database `wat2do`, data in `~/wat2do-data/postgres`.**
The deploy job and the API read it through the `DATABASE_URL` in `~/wat2do-data/config/backend.env`.
Confirm which database `DATABASE_URL` names before running anything destructive.
This prints only the URL's host and database name, never its password:

```bash
(set -a; . ~/wat2do-data/config/backend.env; python3 -c "import os; from urllib.parse import urlsplit; url = urlsplit(os.environ['DATABASE_URL']); print(url.hostname, url.path.lstrip('/'))")
```

The host should be `127.0.0.1` and the database `wat2do`.

Check what a push would apply before it runs, with `DATABASE_URL` set to the same connection string the deploy job uses:

```bash
bash scripts/migrate-database.sh --dry-run
```

The dry run only reads, and lists the migration files the database has not recorded in `public.schema_migrations`.
It fails, as the deploy would, when the database records a version that has no file or when a pending file is dated before the newest applied one.

Schema must land **before** the code that reads it.
The deploy job applies migrations with `scripts/migrate-database.sh` before it switches the Mac to the new release, so a failed migration stops the deploy rather than shipping code against a database that lacks the column.

Prefer additive migrations (`ADD COLUMN ... DEFAULT`, new tables, new indexes).
An additive migration is safe to apply while the previous build is still serving traffic, because unknown columns are ignored by the response models.
A destructive migration is not, and needs a two-step rollout.

---

## 5. Commit

Only commit when the user asked you to, or when your task explicitly includes landing on `main`.

```bash
git add <relevant files>
git commit -m "$(cat <<'EOF'
<concise message focused on why>

EOF
)"
```

Follow the repo's existing commit message style (`git log -5`).

---

## 6. Push

```bash
git push origin main
```

After push, CI/CD runs the backend, Rust and frontend checks.
The deploy job then runs `infra/mac-mini/deploy.sh` on the Mac's own runner: it builds the release, applies pending database migrations, switches the Mac to it, uploads the same commit's website to AWS, and finishes with `scripts/smoke-subdomains.sh`, which asserts a school subdomain never serves another school's feed.
A green local run means those check jobs should pass; the deploy also needs the Mac's configuration under `~/wat2do-data/config` (`docs/projects/mac-mini-hosting.md`).

Agent handoff after a successful push:
- Report the pushed commit and GitHub Actions run URL, then stop.
- Do not wait for CI or the deploy unless the human explicitly requested deployment monitoring or production verification.
- Treat GitHub Actions as the owner of the asynchronous deployment and use its failure notification as the signal for follow-up.

---

## Quick reference (copy-paste)

```bash
# Workflow expression contexts
bash scripts/check-notification-workflow.sh

# Backend
(cd backend && \
  ruff format --check . && \
  ruff check . && \
  mypy . && \
  ENVIRONMENT=testing \
    DATA_API_URL=https://data.example.test \
    DATA_API_KEY=test-service-key \
    pytest -q)

# Rust
(cd rust && \
  cargo fmt --check && \
  cargo clippy --all-targets -- -D warnings && \
  cargo test)

# Frontend
(cd frontend && \
  npm run lint && \
  npm run audit:i18n && \
  npm run type-check && \
  npm test && \
  npm run build)

```

---

## Failure policy

- Fix the failure; do not push broken code to `main`.
- Do not skip hooks (`--no-verify`) or force-push unless the user explicitly requests it.
- Report exactly which command failed and the error output in your handoff.

## Verification

Last agent-verified: 2026-09-26
