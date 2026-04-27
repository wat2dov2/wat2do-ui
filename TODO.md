# TODO.md — Manual deploy steps

Phase 7 deliverable. Every step a human must perform to take wat2do v2 from "code is ready" (where this exercise ended) to "running in prod". Ordered by dependency — earlier items unblock later ones.

Each entry has **What** (concrete action), **Why** (one-line rationale), **Verify** (the check that proves it worked).

> **Status legend.** ⚠ = blocks downstream items. 🛠 = needs code work before the deploy-side work happens.

## Section 0 — Prerequisites in your control

These must be done before any cloud setup makes sense.

### 0.1 ⚠ 🛠 Fix the frontend TypeScript build

- **What.** `npm run build` fails today with the 13 pre-existing TS errors enumerated in `DEPLOYMENT_NOTES.md` (none introduced by this exercise). Each is in a file that wasn't touched between commits `7e71ce1` (v1 sync point) and the start of Phase 1. Two clusters dominate:
  - `useForm<T>` constraint mismatches — `EventFormData`, `CreateQRCodeFormData`, `ClubFormData` (after the same fix), `FilterState` all need either a structural index signature or `useForm`'s constraint loosened to `<T extends object>` and the resulting cascade fixed.
  - Schema drift — `AdminPanel` requires an `events` prop the route doesn't pass; `EventFormStep`'s `handleAiGenerate` is sync where `Promise<void>` is expected; `QrRedirectResult` is missing `destination_type/destination_id/filters`.
- **Why.** Vercel's build runs `npm run build`. Without this fix, the frontend cannot be deployed at all.
- **Verify.** `cd frontend && npm run build` exits 0 with zero new warnings vs. the baseline.

### 0.2 ⚠ Confirm email-domain allowlist for the four added schools

- **What.** Phase 2 added these to `backend/core/allowed_emails.py`: `upenn.edu`, `seas.upenn.edu`, `wharton.upenn.edu`, `nyu.edu`, `stern.nyu.edu`, `columbia.edu`, `cumc.columbia.edu`, `barnard.edu`, `mit.edu`. NYU and Columbia have many sub-domains (engineering, dental, etc.) — confirm the right list with stakeholders and edit the file (or open a follow-up ticket and accept that some sub-domain student emails will hit the signup error).
- **Why.** Real users on un-listed sub-domains will see "email not allowed" at signup; you'll only learn about misses from support tickets.
- **Verify.** Sign up with one email per supported school using the actual student domain; expect success.

### 0.3 ⚠ Apply the new Supabase migration

- **What.** Phase 2 added `backend/supabase/migrations/20260427180000_add_scrape_runs_table.sql`. From `backend/`, run:
  ```bash
  supabase db push --db-url "$DATABASE_URL"
  ```
- **Why.** The scrape pipeline writes per-handle tracking rows to `public.scrape_runs`. Without the table the workflow will 500 on the first insert.
- **Verify.** `supabase db dump --db-url "$DATABASE_URL" --schema public | grep scrape_runs` shows the new table.

## Section 1 — Backend on AWS ECS + ALB

### 1.1 Create the ECR repository and push the backend image

- **What.**
  ```bash
  aws ecr create-repository --repository-name wat2do-backend --region <region>
  aws ecr get-login-password --region <region> \
      | docker login --username AWS --password-stdin <acct>.dkr.ecr.<region>.amazonaws.com
  cd backend
  docker build -t wat2do-backend .
  docker tag wat2do-backend:latest <acct>.dkr.ecr.<region>.amazonaws.com/wat2do-backend:latest
  docker push <acct>.dkr.ecr.<region>.amazonaws.com/wat2do-backend:latest
  ```
- **Why.** ECS task definitions pull from ECR; this is the registry of record.
- **Verify.** `aws ecr describe-images --repository-name wat2do-backend` shows the new digest.

### 1.2 Create IAM execution + task roles

- **What.** Create two roles:
  1. `wat2doExecutionRole` — trust `ecs-tasks.amazonaws.com`, attach AWS-managed `AmazonECSTaskExecutionRolePolicy` (lets ECS pull from ECR + write to CloudWatch Logs).
  2. `wat2doTaskRole` — trust `ecs-tasks.amazonaws.com`. The application doesn't need AWS access (Supabase Storage handles uploads), so leave the inline policy empty unless you add S3/SES/etc. later.
- **Why.** ECS refuses to start a task without an execution role; mixing app permissions into the execution role is the textbook way to grant the puller more than it needs.
- **Verify.** `aws iam get-role --role-name wat2doExecutionRole` returns the role; trust policy allows `ecs-tasks.amazonaws.com`.

### 1.3 Create the ECS cluster

- **What.**
  ```bash
  aws ecs create-cluster --cluster-name wat2do-prod
  ```
  Use Fargate (no EC2 to manage) unless you have an existing EC2-backed cluster.
- **Why.** Cluster is the namespace tasks live in.
- **Verify.** `aws ecs describe-clusters --clusters wat2do-prod` returns `ACTIVE`.

### 1.4 Register the task definition

- **What.** Create a task definition that:
  - Uses `awsvpc` network mode + Fargate launch type.
  - Maps container port `8000`.
  - References the execution role from §1.2 and the (empty) task role.
  - Sets the env vars listed in `DEPLOYMENT_NOTES.md` → "Backend" — pull from AWS Secrets Manager / Parameter Store, never inline values in the task def JSON.
  - Sends logs to a CloudWatch group (e.g. `/ecs/wat2do-backend`).
- **Why.** Each task is a deployment unit; the definition pins the image + env + networking.
- **Verify.** `aws ecs describe-task-definition --task-definition wat2do-backend` returns the new revision.

### 1.5 Create security groups

- **What.** Two SGs in the VPC:
  1. `wat2do-alb-sg` — inbound 80/443 from `0.0.0.0/0`, outbound all.
  2. `wat2do-task-sg` — inbound 8000 from `wat2do-alb-sg` only, outbound 443 to `0.0.0.0/0` (Supabase, OpenAI, Apify all run over HTTPS).
- **Why.** The ALB-only ingress on the task SG keeps the container off the public internet directly.
- **Verify.** `aws ec2 describe-security-groups --group-names wat2do-alb-sg wat2do-task-sg` shows the rules above.

### 1.6 Provision the ALB + ACM cert + Route 53 record

- **What.**
  1. Issue an ACM cert for `api.wat2do.app` (DNS-validate).
  2. Create an internet-facing ALB in two public subnets, with a HTTPS listener on 443 attached to the cert. Attach `wat2do-alb-sg`.
  3. Create a target group: protocol HTTP, port 8000, target type `ip`, health-check path `/health`, healthy threshold 2.
  4. Create the Route 53 A-alias record `api.wat2do.app` → ALB DNS name.
- **Why.** Public clients hit `api.wat2do.app`; the ALB handles TLS and load-balances tasks; the health check is what ECS uses to roll deployments.
- **Verify.** `curl -I https://api.wat2do.app/health` → `HTTP/2 200`.

### 1.7 Create the ECS service

- **What.** `aws ecs create-service` against the cluster from §1.3 + task definition from §1.4 + target group from §1.6, with desired count ≥ 1, network config using two private subnets and `wat2do-task-sg`.
- **Why.** Service keeps tasks running, reschedules failures, and registers them with the target group.
- **Verify.** Service status = `ACTIVE`, running count = desired count, ALB target group shows healthy targets.

## Section 2 — Frontend on Vercel

> Section 1 must be live first so `VITE_API_URL` has a real value to point at.

### 2.1 Create the Vercel project

- **What.** From the Vercel dashboard, "Import Git Repository" → `tonyqiu123/wat2do-ui`, set:
  - Framework Preset: **Vite**.
  - Root Directory: `frontend`.
  - Build Command: `npm run build`.
  - Output Directory: `dist`.
  - Install Command: `npm install`.
- **Why.** Vercel auto-detects Vite, but the root directory must be set because the repo is a monorepo (`backend/` + `frontend/`).
- **Verify.** First deploy shows "Build successful" and a preview URL responds 200 on `/`.

### 2.2 Set the Vercel project env vars

- **What.** From the project settings → Environment Variables, add:
  - `VITE_API_URL` → `https://api.wat2do.app` (Production).
  - `VITE_MAPBOX_TOKEN` (Production) — only if the map view is enabled in your release.
  - `VITE_CLARITY_PROJECT_ID` (Production) — optional analytics.
- **Why.** Vite inlines `VITE_*` env vars into the bundle at build time; setting them after the first build requires a re-deploy.
- **Verify.** Trigger a redeploy; in the deployed app, the network panel shows requests going to `api.wat2do.app/...`.

### 2.3 Attach the custom domain

- **What.** In Vercel project → Domains, add `wat2do.app` (apex) and `www.wat2do.app`. Vercel will give you the CNAME / A records to add in Route 53.
- **Why.** Users hit `wat2do.app`, not the auto-generated `*.vercel.app` URL.
- **Verify.** `dig wat2do.app` shows Vercel's edge IPs; HTTPS works (Vercel provisions the cert automatically).

## Section 3 — GitHub repo secrets

Set these on `tonyqiu123/wat2do-ui` (Settings → Secrets and variables → Actions → Repository secrets). The workflows reference them by exact name.

### 3.1 Required for `big-scrape.yml` and `process-single-user.yml`

- `SUPABASE_URL`
- `SUPABASE_KEY` (anon key)
- `SUPABASE_SECRET_KEY` (service-role key)
- `SUPABASE_JWT_SECRET`
- `OPENAI_API_KEY`
- `APIFY_API_TOKEN`

### 3.2 Required for `nightly-recs.yml` (already existed)

- `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY`, `DATABASE_URL`

### 3.3 PAT for `process-single-user.yml` external trigger (optional)

- A `repo`-scoped PAT used by the external service that fires `repository_dispatch` with type `new_instagram_post`. **Not** stored as a workflow secret — it's held by whatever service invokes the dispatch endpoint.

**Verify all of §3.** Click "Run workflow" on `big-scrape.yml` with `dry_run=true` and a small `limit` (say 10). The job should:
- Pass the install + scrape steps.
- Print a `[DRY-RUN] {school}: 1 handle(s), N post(s) fetched, M event(s) extracted, K event(s) would be saved` line.
- Upload the `big-scrape-logs-{run_number}` artifact.
- Exit 0.

Then run with `dry_run=false` and `limit=10` to confirm rows land in `events` + a `scrape_runs` row appears.

## Section 4 — Manual security verifications

### 4.1 Verify QR admin-only enforcement live

- **What.** With a running backend (locally or via §1):
  ```bash
  ADMIN_TOKEN=$(...)        # admin Supabase JWT
  USER_TOKEN=$(...)         # non-admin Supabase JWT
  BASE=http://localhost:8000  # or https://api.wat2do.app

  curl -i -H "Authorization: Bearer $USER_TOKEN" "$BASE/qr/"        # expect 403
  curl -i -H "Authorization: Bearer $ADMIN_TOKEN" "$BASE/qr/"       # expect 200
  curl -i -H "Authorization: Bearer $USER_TOKEN" \
       -H 'Content-Type: application/json' \
       -d '{"id":"test","name":"x","destination_type":"custom-url"}' \
       "$BASE/qr/"                                                   # expect 403
  curl -i "$BASE/qr/SOME_REAL_POSTER_ID"                             # expect 200 (public scan)
  ```
- **Why.** The pytest cases (`test_*_non_admin_rejected` in `backend/tests/routers/test_qr.py`) cover the contract; this is the live equivalent the master prompt asked for.
- **Verify.** Status codes match the comments above.

### 4.2 Re-grep frontend for new credential leaks

- **What.** Before each release: `grep -rn "localStorage.setItem\|sessionStorage.setItem" frontend/src/`. Any new key must appear in `frontend/src/shared/constants/storageKeys.ts` and must not store an access token, refresh token, or anything that would be a credential if leaked.
- **Why.** The current writers are confined to one file each (`storageService.ts`, `trackingService.ts`); a regression that adds a second writer is the canary worth catching at PR review.
- **Verify.** Grep returns only `storageService.ts:28` and `trackingService.ts:25`.

## Section 5 — Things that need 2FA / human credentials

These can't be automated and will require a human at the keyboard.

- **AWS account access** — IAM Identity Center or root with MFA.
- **Vercel team / project owner** — who owns `wat2do.app` in Vercel.
- **Supabase project owner** — who can read the service-role key in the dashboard.
- **Apify account** — owner of the `apify_api_*` token.
- **OpenAI account** — billing email tied to the `sk-*` key.
- **Domain registrar** — whoever holds `wat2do.app` in Cloudflare/Namecheap/etc. for DNS NS / nameserver changes if you ever migrate DNS providers.

## Section 6 — Operational hand-offs that lived under the exercise but didn't make code

- **`gh workflow run`-based smoke tests** — the master prompt asked for `gh workflow run big-scrape.yml -f dry_run=true` post-merge. This requires §3 secrets to be set; logged here as the gating step that's expected after the workflow files land on `main`.
- **`docker build .` smoke test** — could not run from the Phase 6 sandbox because the Docker daemon was not available. Run once locally before §1.1's `docker push`.
- **`backend/scripts/verify_qr_endpoints.sh`** — currently exercises only the public scan endpoint. The script could be extended to round-trip an admin and non-admin JWT (see §4.1) to make it the operational equivalent of the pytest cases.
