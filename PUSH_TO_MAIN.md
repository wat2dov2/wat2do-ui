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
- Restore generated noise (e.g. `frontend/test-results/`) instead of committing it.

Optional codebase health scan (fix major issues; do not block on pre-existing complexity debt):

```bash
npx fallow
```

---

## 2. Backend checks

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
  SUPABASE_URL=https://example.supabase.co \
  SUPABASE_KEY=test-anon-key \
  SUPABASE_SECRET_KEY=test-service-role-key \
  SUPABASE_JWT_SECRET=test-jwt-secret \
  pytest -q
```

---

## 3. Frontend checks

From repo root:

```bash
cd frontend
npm ci   # skip if node_modules already matches package-lock.json
```

Run **all four** commands. Each must exit 0:

```bash
npm run lint
npm run audit:i18n
npm run type-check
NEXT_PUBLIC_API_URL=/api npm run build
```

---

## 4. Waterloo Commons checks

From repo root:
Use Node.js 22.x so the local runtime matches CI and Vercel.

```bash
cd waterloo-commons
npm ci   # skip if node_modules already matches package-lock.json
```

Use only inert CI values in this local gate.
Never paste production credentials into the shell history or repository.

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key
export SUPABASE_SECRET_KEY=test-secret-key
export OPENAI_API_KEY=test-openai-key
export NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA
export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
export REQUEST_FINGERPRINT_SECRET=test-request-fingerprint-secret-at-least-32-bytes
export CRON_SECRET=test-cron-secret-at-least-32-bytes

npm run lint
npm run type-check
npm test
npm run build
```

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

After push, CI/CD runs the same backend, frontend, and Waterloo Commons jobs.
It then deploys the backend to Railway and each Next.js application to its separate Vercel project when that deployment's secrets are configured.
A green local run means those check jobs should pass; deploy steps depend on repository secrets.

---

## Quick reference (copy-paste)

```bash
# Backend
(cd backend && \
  ruff format --check . && \
  ruff check . && \
  mypy . && \
  ENVIRONMENT=testing \
    SUPABASE_URL=https://example.supabase.co \
    SUPABASE_KEY=test-anon-key \
    SUPABASE_SECRET_KEY=test-service-role-key \
    SUPABASE_JWT_SECRET=test-jwt-secret \
    pytest -q)

# Frontend
(cd frontend && \
  npm run lint && \
  npm run audit:i18n && \
  npm run type-check && \
  NEXT_PUBLIC_API_URL=/api npm run build)

# Waterloo Commons
(cd waterloo-commons && \
  export NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co && \
  export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=test-publishable-key && \
  export SUPABASE_SECRET_KEY=test-secret-key && \
  export OPENAI_API_KEY=test-openai-key && \
  export NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA && \
  export TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA && \
  export REQUEST_FINGERPRINT_SECRET=test-request-fingerprint-secret-at-least-32-bytes && \
  export CRON_SECRET=test-cron-secret-at-least-32-bytes && \
  npm run lint && \
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

Last agent-verified: 2026-06-16
