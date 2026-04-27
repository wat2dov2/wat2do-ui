# AUDIT.md — wat2do v2 vs v1

Phase 1 deliverable. Diffs the v2 rewrite against v1 for every in-scope feature listed in the master prompt. No code in this phase. Subsequent phases depend on the gap list at the bottom.

## Repos

| | v2 (work here) | v1 (reference) |
|---|---|---|
| Path | `/Users/tqiu/test/` | `/Users/tqiu/wat2do/` |
| Remote | `tonyqiu123/wat2do-ui` | `ericahan22/Wat2Do` |
| Backend | FastAPI + Supabase (PostgREST) | Django + Postgres (Supabase) |
| Frontend | React 19 + Vite + TS, Zustand, shadcn/ui | React 19 + Vite + TS, Zustand, Radix |
| Auth | Custom (Supabase JWT, httpOnly refresh cookie, in-memory access token) | Clerk |
| Migrations | Supabase CLI (`backend/supabase/migrations/`) | Django migrations |

v2 is a rewrite, not a port. **Do not copy v1 Django code into v2.** Translate idiomatically: Django ORM → Supabase client, Django views → FastAPI routers in `routers/`, DRF serializers → Pydantic schemas in `schemas/`.

## Method

- Parallel exploration of both repos via subagents (mapped layout, routers, services, workflows).
- Spot-check reads of `backend/main.py`, `core/allowed_emails.py`, `routers/qr.py`, `frontend/shared/constants/storageKeys.ts`, `frontend/shared/services/trackingService.ts`.
- Grep for `apify`, `instagram_scraper`, `localStorage.setItem`, `sessionStorage.setItem`.
- File listings of `backend/services/wat2do/` (empty) and `.github/workflows/` (one workflow).

## v2 backend layout (for reference in later phases)

`backend/`
- `core/` — config, auth (`is_admin`, `get_db_user`), CORS, error handlers, pagination, rate limiting, security headers, allowed-email/school list.
- `routers/` (19 files, auto-discovered alphabetically by `main.py`) — `auth`, `events`, `clubs`, `submissions`, `users`, `saved_events`, `calendar`, `qr`, `notification_preferences`, `interactions`, `recommendations`, `credits`, `reports`, `meta`, `scraped_events`, `uploads`, `ai`, `ab_test`.
- `services/` — business-logic layer; includes `services/wat2do/` (empty placeholder, where the scraping pipeline likely belongs).
- `schemas/` — Pydantic request/response models.
- `tests/` — pytest with `conftest.py` fixtures (`authenticated_client`, `admin_client`, `other_user_client`).
- `jobs/` — `compute_recommendations.py`, `send_notifications.py`. No scraping job yet.
- `supabase/migrations/` — schema authority.
- `Dockerfile` — present, minimal `python:3.12-slim` + uvicorn.

`frontend/src/`
- `app/App.tsx` — router with lazy-loaded pages, `ProtectedRoute requiredRole={ROLE_ADMIN}` guards on `/admin/*`, `requiredRole={ROLE_CLUB}` on `/club-panel/*`.
- `features/` — `auth`, `events`, `clubs`, `admin`, `club-panel`, `qrcode`, `submissions`, `settings`, `search`, `recommendations`, `credits`, `commands`, `about`, `marketing`.
- `shared/` — `api/`, `components/`, `services/apiClient.ts` (in-memory token + fetch wrapper), `services/storageService.ts`, `services/trackingService.ts`, `constants/storageKeys.ts`, Zustand stores.
- `Dockerfile` — multi-stage Vite → nginx.

## Per-feature audit

### 1. Auth — sign up / sign in / sign out / sessions

**State in v2:** working.

**Implementation:**
- Backend: `backend/routers/auth.py` exposes `POST /auth/signup|login|logout|refresh|forgot-password|reset-password`. Refresh token in httpOnly + Secure + SameSite=Lax cookie scoped to `/auth/refresh`. Access token returned in JSON body.
- Backend startup: `backend/main.py:28-32` rejects `CORS_ORIGINS=["*"]` with credentials enabled (CSRF defense already in place).
- Frontend: access token held **in memory** by `frontend/src/shared/services/apiClient.ts`. Cleared on logout. localStorage holds only non-credential caches (`userEmail`, `userProfile`, `theme`, `i18n-language`, `notificationPreferences`, `privacyPreferences`). `sessionStorage` holds `wat2do_session_id` (analytics UUID).
- Email allowlist: `backend/core/allowed_emails.py` with NFKC + IDNA normalisation against homograph attacks; rejects control chars and multi-`@` payloads.

**Source in v1:** v1 uses Clerk; not portable. v2's auth is independent and complete.

**Risk / unknowns:**
- Email confirmation: `signup` returns `confirmation_required` flag but no confirmation endpoint was located — verify in Phase 4 whether email verification is wired or stubbed.
- No social/OAuth login (out of scope for this exercise).

**What's missing for deploy:** nothing functional. Phase 5 will re-grep storage to confirm no token leaks; current scan returned only `trackingService.ts:25` (sessionStorage SESSION_ID, expected) and `storageService.ts:28` (the abstraction layer itself).

---

### 2. Events — list, filter, detail, school-scoped, past filter, interest, calendar export

**State in v2:** working with two minor gaps.

**Implementation:**
- Backend: `backend/routers/events.py` — full CRUD plus `GET /events/latest-added`. Filters: `category`, `club_type`, `school`, `search`, `from_date`, `to_date`, `has_food`, `max_price`, `registration`, `summary`, `include_cancelled`.
- Saved-events / interest: `backend/routers/saved_events.py` (separate router). `GET/PUT/DELETE /saved-events/[/{event_id}]`.
- Calendar export (.ics): `backend/routers/calendar.py` — token-based feed (`GET /calendar/token`, `GET /calendar/feed/{token}.ics`, `POST /calendar/token/regenerate`), rate-limited per token. Uses `icalendar` package.

**Source in v1:**
- `backend/apps/events/views.py` — REST endpoints (note v2 already does this idiomatically; do not port).
- `backend/apps/events/models.py` — Events + EventDates (multi-occurrence). v2 must reproduce the multi-occurrence shape per the scraping port (Phase 2). Confirm v2 schema supports occurrences before Phase 2.
- v1 also had `GET /api/events/google-calendar-urls/` returning per-event Google Calendar template links — not present in v2.

**What's missing:**
- **Google Calendar URL generation.** v1 had it; v2 doesn't. (Calendar template URL: `https://www.google.com/calendar/render?action=TEMPLATE&text=…&dates=…/…&details=…&location=…`.) Add to `routers/calendar.py` or `routers/events.py` per v2's preferred placement.
- **Calendar view UI** in `features/events/` is stubbed "coming soon". Out of scope unless the master prompt's "calendar export" is read as both .ics + Google URLs + UI; will treat the .ics + Google URLs as in-scope, the in-app calendar view as out-of-scope.
- **School-scoping default.** Backend supports `school` query filter, but does not implicitly default to the authenticated user's school. Front-end behavior to confirm in Phase 4: when an NYU user opens `/events`, does the page send `school=NYU` automatically?

**Risk / unknowns:**
- Multi-occurrence event shape in Supabase schema needs verification before Phase 2 can insert the multi-date events the scraper produces.
- Past-event filter is via `from_date >= now()`-style query; confirm UI default in Phase 4.

---

### 3. Clubs directory

**State in v2:** partial — **major scope mismatch with the master prompt.**

**Implementation:**
- Backend: `backend/routers/clubs.py` — full CRUD, paginated list with `club_type` and `search`. School field on Clubs row.
- Frontend: `features/clubs/` — list + search UI.

**Source in v1:** `backend/apps/clubs/models.py` — Clubs(club_name unique, categories JSON, club_page, ig, discord, club_type).

**What's missing — schools:** the master prompt requires UWaterloo, UPenn, NYU, Columbia, MIT. v2's `core/allowed_emails.py` currently supports:
- `uwaterloo.ca`, `edu.uwaterloo.ca` → University of Waterloo
- `wlu.ca`, `mylaurier.ca` → Wilfrid Laurier University
- `uoguelph.ca` → University of Guelph
- `conestogac.on.ca` → Conestoga College

**Gap to close:** add UPenn, NYU, Columbia, MIT to `ALLOWED_EMAIL_DOMAINS`, and matching timezone/semester data wherever v2 holds it (need to locate or create the v2 equivalent of v1's `backend/utils/date_utils.py` school table during Phase 2). Recommend keeping the existing Ontario schools — removing them is out-of-scope churn.

**Risk / unknowns:**
- Existing Ontario clubs/events in the seed data: verify Phase 4 that adding new schools doesn't break their views.
- Email domain choices for NYU/Columbia (e.g. `nyu.edu`, `cumc.columbia.edu`, etc.) need to be confirmed with the user — multiple sub-domains per school exist.

---

### 4. Scraping pipeline

**State in v2:** **missing entirely.**

**Verification:** `grep -r -l -i "apify|instagram_scraper|InstagramScraper" /Users/tqiu/test/backend/` → 0 matches. `services/wat2do/` is empty. `requirements.txt` (per audit) does not include `apify-client`, `boto3`, `openai` for vision, or `Pillow` for the v1-style image pipeline.

**What v2 has:** a data shape (`schemas/scraped_event.py`), a service layer (`services/scraped_event_service.py`), and a read-only router (`routers/scraped_events.py`). Plenty of scaffolding; zero ingestion.

**Source in v1 — full file map for the Phase 2 port:**

| Concern | v1 path | Notes |
|---|---|---|
| Single-user orchestrator | `backend/scraping/main.py` | reads `TARGET_USERNAME` env; writes ScrapeRun rows |
| Batch orchestrator | `backend/scraping/main_big_scrape.py` | `--urls-file`, `--school`, `--limit`, `--cutoff-days`, `--dry-run`; chunks 100 handles per Apify run; 1-hour timeout per chunk |
| Apify client | `backend/scraping/instagram_scraper.py` | wraps `apify/instagram-post-scraper`; always sets `skipPinnedPosts=True`; polls every 5s |
| Post-processing pipeline | `backend/scraping/event_processor.py` | filter → upload → extract → save (async, semaphore-bounded) |
| OpenAI vision extraction | `backend/services/openai_service.py` | model `gpt-5-mini`; injects school/current-date/post-date/semester-end into prompt; **inserts `Image N:` text label before each image_url block (commit f51be22) — must preserve** |
| S3 upload | `backend/services/storage_service.py` | ACL `public-read`, Cache-Control `max-age=31536000`, 10MB limit, JPEG/PNG/WEBP, 3-retry exponential backoff |
| Dedup + insert | `backend/utils/scraping_utils.py` | `EventDuplicateDetector` (Jaccard + SequenceMatcher, thresholds: same-club 0.8, title 0.7, location 0.5, description 0.3); `insert_event_to_db()` returns `True / "updated" / "duplicate" / "missing_occurrence"` |
| School/timezone/semester | `backend/utils/date_utils.py` | `get_default_timezone(school)`, `get_current_semester_end_time(school)`, school table for UW/UPenn/NYU/Columbia/MIT |
| Per-school URL files | `backend/shared/constants/urls_uwaterloo.txt`, `urls_upenn.txt`, `urls_nyu.txt`, `urls_columbia.txt`, `urls_mit.txt` | one IG URL per line; `#` comments and blanks ignored |
| ScrapeRun model | `backend/apps/scraping/models.py` | tracks per-user scrape jobs (`status`, `posts_fetched`, `posts_new`, `events_extracted`, `events_saved`, `pinned_post_warning`, `error_message`, timestamps) |

**Behaviors that must be preserved (per CLAUDE.md and recent v1 commits):**
1. Inline `Image N:` text labels before each `image_url` block in the OpenAI message (commit `f51be22`).
2. Dry-run mode skips ScrapeRun row creation **and** the seen-shortcodes filter (commit `bb1595b`).
3. Apify chunking: 100 handles per run, 1-hour timeout (commit `ee1a954`).
4. Pinned-post exclusion at Apify (`skipPinnedPosts=True`) plus a server-side warning if Apify returns one anyway.
5. Past-event skip: drop events whose `dtstart_utc < now()` before insert.
6. Single-image multi-event consolidation: merge into a single "{ClubName} Weekly Events" event with all occurrences when the AI extracts >1 event from a 1-image post.

**Risk / unknowns for Phase 2:**
- v2 schema may not yet model multi-occurrence EventDates the way the scraper expects. Verify `supabase/migrations/` before writing the insert path.
- No ScrapeRun-equivalent table exists in v2. Either add a migration or surface as a TODO.md item if the user wants it deferred.
- API keys (Apify, OpenAI, AWS) and their env-var names need to match v2's existing `core/config.py` style; the names are NOT yet in `backend/.env.example`.

---

### 5. GitHub Actions workflows

**State in v2:** minimal — only `.github/workflows/nightly-recs.yml` exists.

**Source in v1:**
- `.github/workflows/big-scrape.yml` — workflow_dispatch with `school` (choice of 5), `limit`, `cutoff_days`, `dry_run`. Calls `python -u main_big_scrape.py --urls-file {URLS_FILE} --school {school} --limit {limit} --cutoff-days {cutoff_days} [--dry-run]`. URL-file mapping is done inside the workflow via case statement against the school name. Uploads `events_scraped.csv`, `scraping.log`, `apify_raw_results.json` as artifacts.
- `.github/workflows/process-single-user.yml` — triggers on `repository_dispatch` (event `new_instagram_post`) **and** `workflow_dispatch` with `username` input. Sets `TARGET_USERNAME` env from either source. Sets `IGNORE_CUTOFF=true` only when manually dispatched. Uses concurrency group `apify-scrape-group` to prevent parallel scrapes.

**What's missing:** both workflows. v2 also needs `requirements.txt` updates so the workflow's Python install picks up `apify-client`, `openai`, `boto3`, `Pillow`, etc.

**Out of scope — explicitly skip these v1 workflows:**
- `cleanup-storage.yml`
- `deploy-backend.yml`
- `update-events-data.yml`
- `validate-event-sources.yml`
- `send-newsletter.yml`

**Risk / unknowns:**
- v2 secrets need to be set on GitHub at the user's tonyqiu123/wat2do-ui repo level. Names go in TODO.md (Phase 7); the workflows reference them but don't provide values.
- `repository_dispatch` requires a PAT with `repo` scope wherever the external trigger lives. Document in TODO.md.

---

### 6. Admin panel

**State in v2:** working.

**Implementation:**
- Backend: `backend/routers/submissions.py` (admin CRUD on submissions) + `backend/routers/credits.py` (promotions). Both routers use `is_admin(db_user)` gates from `core/auth.py`.
- Frontend: `frontend/src/features/admin/` — `AdminEventsPage`, `AdminClubsPage`, `AdminSubmissionsPage`, `AdminPostersPage`. All routes wrapped in `ProtectedRoute requiredRole={ROLE_ADMIN}` per `App.tsx`.

**Source in v1:** `backend/apps/promotions/` and the `SubmissionsReviewPage` in the v1 frontend — already idiomatically reproduced in v2; nothing to port.

**What's missing:** nothing identified. Phase 4 will exercise approve/reject and promote/unpromote against a real DB to confirm.

**Risk / unknowns:** none.

---

### 7. User settings

**State in v2:** working.

**Implementation:**
- Frontend: `features/settings/SettingsPage` with `ProfileTab` (school, interests, first-year, faculty, year), `AppearanceTab` (theme, calendar view), `NotificationsTab` (morning/weekly digest, event-change), `PrivacyTab`.
- Backend: `routers/users.py` `GET /users/me`, `PATCH /users/me/profile`. Notification prefs in `routers/notification_preferences.py`.

**What's missing:** nothing in scope. Theme/school round-trip is the primary requirement; Phase 4 will exercise it.

**Risk / unknowns:**
- School dropdown in `ProfileTab` reads from a frontend constants list. Once `ALLOWED_EMAIL_DOMAINS` is expanded for the new schools, the dropdown source needs the same expansion. Note the dependency for Phase 2/4.

---

### 8. QR code feature — must be admin-only

**State in v2:** **partial — backend is NOT admin-only.**

**Verification:** read `backend/routers/qr.py` directly.

**Findings:**
- `POST /qr/` (`create_poster`) — only requires `db_user` (any authenticated user). **Must be admin-only per the master prompt.**
- `PATCH/DELETE /qr/{id}` — owner-or-admin via `_get_poster_or_404_authorized`. Acceptable for owner of an admin-created poster, but if creation is admin-only the owner is always an admin, so this is fine.
- `GET /qr/` (`list_qr_codes`) — admins see all, non-admins see their own. **Per the master prompt, normal users must NOT have access** → must restrict to admin-only.
- `GET /qr/scans` — same pattern as list, same fix needed.
- `GET /qr/{id}` (public redirect, records scan) — intentionally public, no auth. This is the public scan endpoint and is correct.

**Frontend side:**
- QR creation/management UIs live under `features/qrcode/` and are reached only from `/admin/posters` (gated by `ProtectedRoute requiredRole={ROLE_ADMIN}` in `App.tsx`). The route-level guard exists; backend enforcement is the gap.
- `verify_qr_endpoints.sh` script exists per the master prompt — exercise in Phase 5 with an admin and a non-admin token.

**Source in v1:** v1 didn't have a QR code feature; this is v2-only. No port needed; just lockdown.

**What's missing:**
- Add `is_admin(db_user)` guard to `POST /qr/`, `GET /qr/`, `GET /qr/scans`, `PATCH /qr/{id}`, `DELETE /qr/{id}`. Public redirect (`GET /qr/{id}` -> resolve_qr_and_record_scan) stays public.
- Update tests to reflect non-admin = 403.

**Risk / unknowns:**
- Existing non-admin-created QR codes in the DB (if any seed data exists). Phase 4 will check.

---

### 9. Submissions

**State in v2:** working.

**Implementation:** `backend/routers/submissions.py` — user `POST /submissions/` (rate-limited), admin `GET /submissions/`, `GET /submissions/{id}`, `PATCH /submissions/{id}`, `DELETE /submissions/{id}`.

**Source in v1:** `backend/apps/events/` had `EventSubmission` model + AI-extraction endpoint (`POST /api/events/extract/`). v2's submissions are user-form-driven (no AI extraction). Per the master prompt, submissions are in-scope but AI extraction is **not** explicitly required — out of scope unless verified missing in Phase 4.

**What's missing:** verify Phase 4 that the user submit flow + admin approve/reject works against a real DB.

**Risk / unknowns:** none.

---

## Cross-cutting findings

### School scope (largest impact)

v2 ships with 4 Ontario schools (UWaterloo, Laurier, Guelph, Conestoga). The master prompt requires UWaterloo + UPenn + NYU + Columbia + MIT. Plan: **add the 4 missing schools, leave the existing Ontario ones alone** (removing them is out-of-scope churn).

Touch points for this expansion (every site that needs an entry):
1. `backend/core/allowed_emails.py` — `ALLOWED_EMAIL_DOMAINS`. Need user input on each school's email domains (e.g., `nyu.edu` plus engineering sub-domains, `cumc.columbia.edu` for medical, etc.).
2. v2's school timezone / semester table — need to locate or create (Phase 2 deliverable; v1 has it at `backend/utils/date_utils.py`).
3. `frontend/src/features/settings/` school dropdown — wherever the constants list lives.
4. Per-school URL files for the scraper — `backend/shared/constants/urls_*.txt` or v2's chosen path (Phase 2).

**Open question for the user:** confirm exact email domains per school. NYU/Columbia in particular have many sub-domains. If unanswered, default to a single primary domain per school and surface in TODO.md.

### Tests

v2's test suite (38 files, pytest) lives under `backend/tests/` and uses `conftest.py` fixtures (`authenticated_client`, `admin_client`, `other_user_client`). New scraping/extraction tests must follow the same pattern. No new frameworks. No skipped tests, no `xfail`.

### Frontend storage policy

`storageKeys.ts` has an explicit allowlist comment ("Allowed per CLAUDE.md localStorage policy") and the only writers are `storageService.ts` (the abstraction) and `trackingService.ts` (sessionStorage SESSION_ID). **No tokens are written to localStorage.** Phase 5 will re-confirm with a fresh grep but the audit shows the policy is being respected.

### Notifications

v2 has email digest infrastructure (`jobs/send_notifications.py`, `routers/notification_preferences.py`) that v1 also had as a "newsletter" feature. The master prompt explicitly excludes the newsletter feature. **Action: leave v2's notifications code intact, do not exercise its email-sending paths in Phase 4, do not include it in TODO.md.**

## Out of scope (per the master prompt) — do not touch

- Newsletter / email-digest user-facing pages, scheduled jobs (v2's `send_notifications.py` may stay; do not improve it).
- v1 workflows: `send-newsletter.yml`, `cleanup-storage.yml`, `deploy-backend.yml`, `update-events-data.yml`, `validate-event-sources.yml`.
- Recommendations feature deep work — only verify it doesn't crash; no improvements (`features/recommendations/`, `routers/recommendations.py`, `jobs/compute_recommendations.py`).
- Actual deploy actions (`terraform apply`, ECR push, Vercel project config). All such steps go in TODO.md (Phase 7).
- Existing Ontario schools (Laurier, Guelph, Conestoga) — leave as-is.

## Phase 1 → Phase 2 hand-off — gap list

Ordered by dependency:

1. **Migrations** — verify (or add) Supabase migrations for: (a) ScrapeRun-equivalent table, (b) Events row supporting multi-occurrence dates as the scraper emits, (c) any new fields on Clubs/Events the scraper writes (`ig_handle`, `source_url`, `source_image_url`, `posted_at`, `likes_count`, `comments_count`, `food`, `registration`, `price`, `school`, `club_type`, `categories`).
2. **School table** — add `backend/core/schools.py` (or v2's chosen path) with timezones + semester end dates for UW + UPenn + NYU + Columbia + MIT. Wire into `allowed_emails.py` and the frontend school dropdown source.
3. **URL files** — copy `urls_uwaterloo.txt`, `urls_upenn.txt`, `urls_nyu.txt`, `urls_columbia.txt`, `urls_mit.txt` from v1 `backend/shared/constants/` into v2 at the same relative path.
4. **Scraping module** — port v1's pipeline into `backend/services/wat2do/` (already-empty placeholder) or `backend/scraping/` (v2's chosen path; pick one and stick with it). Apply the FastAPI/Supabase translation, preserve the 6 behaviors listed in §4.
5. **Tests** — pytest for the new module, in v2's existing style.
6. **Workflows** — add `.github/workflows/big-scrape.yml` and `.github/workflows/process-single-user.yml`. Adapt secret names to v2's preferences.
7. **QR lockdown** — Phase 5 work, not Phase 2.

## Phase 1 → Phase 5 hand-off — security gap list

1. Add `is_admin` guards to `POST /qr/`, `GET /qr/`, `GET /qr/scans`, `PATCH /qr/{id}`, `DELETE /qr/{id}`.
2. Re-grep frontend for `localStorage.setItem|sessionStorage.setItem` after Phase 2/3/4 land. Current scan is clean.
3. Run `verify_qr_endpoints.sh` against an admin and a non-admin token; expect 401/403 for non-admin.
4. Confirm `CORS_ORIGINS` startup check still rejects `*` (already verified at `backend/main.py:28-32`).

## Phase 1 → Phase 7 hand-off — known TODO.md items

Items that will need user action no matter what — collect these as we go:

- GitHub repo secrets to set on `tonyqiu123/wat2do-ui`: `APIFY_API_TOKEN`, `OPENAI_API_KEY`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION`, `AWS_S3_BUCKET_NAME`, `SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL`. Names only.
- Confirm exact email domain set for each new school (UPenn, NYU, Columbia, MIT) — possibly multiple per school.
- AWS console: ECR repo, ECS cluster + service + task definition, ALB + ACM cert, IAM roles, security groups, Route 53 record.
- Vercel: project on the frontend folder, env vars, custom domain, build cmd verification.
- Supabase: any migrations the user must run manually.
- DNS records.
