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
NEXT_PUBLIC_API_URL=/api npm run build
```

---

## 4. Terraform checks

Run these checks whenever `infra/terraform/` or the Terraform workflow changes.

```bash
terraform fmt -check -recursive infra/terraform
(cd infra/terraform/foundation && terraform init -backend=false && terraform validate)
(cd infra/terraform/production && terraform init -backend=false && terraform validate)
```

Run `tflint` in each root when it is installed locally or rely on the Terraform workflow's dedicated TFLint job.

A push to `main` cancels the CI/CD deploy already running, and the Terraform apply for that earlier push then stops at "Wait for the matching application release" without applying.
After the latest deploy on `main` succeeds, apply the pending changes with `gh workflow run terraform.yml --ref main`; a manual run on `main` plans and applies against that release.

---

## 5. Database migrations

**Production's database is the Amazon RDS for PostgreSQL 17 instance `wat2do-production`, database `wat2do`, in `ca-central-1`.**
The deploy job reaches it through the production environment's `DATABASE_URL` secret, and the app task through the `DATABASE_URL` key of the runtime secret.
Confirm which database `DATABASE_URL` names before running anything destructive.
This prints only the URL's host and database name, never its password:

```bash
aws secretsmanager get-secret-value --region ca-central-1 \
  --secret-id wat2do/production/runtime --query SecretString --output text \
  | python3 -c "import json,sys; from urllib.parse import urlsplit; url = urlsplit(json.load(sys.stdin)['DATABASE_URL']); print(url.hostname, url.path.lstrip('/'))"
```

The host should start with `wat2do-production.` and end in `.rds.amazonaws.com`, and the database should be `wat2do`.

Check what a push would apply before it runs, with `DATABASE_URL` set to the same connection string the deploy job uses:

```bash
bash scripts/migrate-database.sh --dry-run
```

The dry run only reads, and lists the migration files the database has not recorded in `public.schema_migrations`.
It fails, as the deploy would, when the database records a version that has no file or when a pending file is dated before the newest applied one.

Schema must land **before** the code that reads it.
The deploy job applies migrations automatically ahead of the ECS rollout with `scripts/migrate-database.sh`, using the production environment's `DATABASE_URL` secret.
When that secret is unset, a push that adds migration files fails the deploy rather than shipping code against a database that lacks the column.

Prefer additive migrations (`ADD COLUMN ... DEFAULT`, new tables, new indexes).
An additive migration is safe to apply while the previous build is still serving traffic, because unknown columns are ignored by the response models.
A destructive migration is not, and needs a two-step rollout.

---

## 6. Commit

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

## 7. Push

```bash
git push origin main
```

After push, CI/CD runs the backend, Rust and frontend checks.
The deploy job then applies pending database migrations, rolls out ECS, and finishes with `scripts/smoke-subdomains.sh`, which asserts a school subdomain never serves another school's feed.
The Wat2Do frontend and backend deploy together to ECS through GitHub OIDC and the immutable ECR release flow.
A green local run means those check jobs should pass; the AWS deployment requires the repository variables and Secrets Manager values documented in the Terraform roots.

Agent handoff after a successful push:
- Report the pushed commit and GitHub Actions run URL, then stop.
- Do not wait for CI or the AWS rollout unless the human explicitly requested deployment monitoring or production verification.
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
  NEXT_PUBLIC_API_URL=/api npm run build)

```

---

## Failure policy

- Fix the failure; do not push broken code to `main`.
- Do not skip hooks (`--no-verify`) or force-push unless the user explicitly requests it.
- Report exactly which command failed and the error output in your handoff.

## Verification

Last agent-verified: 2026-09-26
