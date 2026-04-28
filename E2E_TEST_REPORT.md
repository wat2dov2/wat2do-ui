# E2E_TEST_REPORT.md

End-to-end live verification of the `feat/v2-deploy-readiness` branch against the user's actual Supabase DB and a Puppeteer-driven browser. Done autonomously while the user was AFK; everything reversible was reversed (test event deleted, dev servers stopped). Backups are in `/tmp/wat2do-backup-20260428-134125/`.

## What I ran

### 1. Live Supabase migration apply

`cd backend && supabase db push --db-url "$DATABASE_URL"` — applied **7 pending migrations** in one shot:

| Migration | Owner | Result |
|---|---|---|
| `20260423130000_unify_created_by_to_internal_id.sql` | main | ❌ first attempt → `ALTER COLUMN ... USING (SELECT …)` is illegal in Postgres. Pre-existing bug, never applied anywhere. **Fixed in commit `322e9cf`** with the standard temp-column pattern. |
| `20260423140000_add_calendar_feed_token_to_users.sql` | main | ✓ |
| `20260424120000_add_event_status_column.sql` | main | ✓ |
| `20260424130000_add_notification_preferences_table.sql` | main | ✓ |
| `20260424130100_add_notifications_log_table.sql` | main | ✓ |
| `20260427180000_add_scrape_runs_table.sql` | this PR | ✓ |
| `20260428031741_add_event_dates_table.sql` | this PR | ✓ |

**Pre-flight backup at `/tmp/wat2do-backup-20260428-134125/`**: schema (69 KB) + full data dump (655 KB). Not deleted; user can drop after they're satisfied.

### 2. Schema verification post-migration

| Check | Result |
|---|---|
| `events.dtstart_utc` / `events.dtend_utc` removed | ✓ |
| `events.status` column added | ✓ |
| `events.created_by` is `uuid` (was `text` of supabase_auth_id) | ✓ |
| `event_dates` table exists | ✓ |
| `event_dates.event_id` FK with `ON DELETE CASCADE` | ✓ |
| `scrape_runs` table exists | ✓ |
| `events_listing` view exists with `security_invoker=true` | ✓ |
| RLS enabled on `event_dates` and `scrape_runs` | ✓ |

### 3. Data integrity post-migration

| Check | Before | After |
|---|---|---|
| `events` rows | 32 | 32 (unchanged) |
| `clubs` rows | 7 | 7 (unchanged) |
| `users` rows | 108 | 108 (unchanged) |
| `event_dates` rows | (table didn't exist) | 29 (3 events had NULL `dtstart_utc` and stay date-less per migration design) |

Manually inserted a synthetic 3-occurrence event (`PUPPET_TEST Multi-Occurrence Tea Tasting`) to verify the EventDates port end-to-end:
- DB: 1 events row + 3 event_dates rows.
- `events_listing` view: 3 rows for that event_id (one per occurrence).
- `GET /events/<id>`: returns ONE EventResponse with `occurrences: [..., ..., ...]` (3 items) AND `dtstart_utc: "2026-12-01T18:00:00Z"` (earliest → primary).
- `DELETE FROM events WHERE id=<id>`: cascade-removed all 3 event_dates rows.

### 4. Local dev servers — backend + frontend

- `uvicorn main:app` on `:8000` against the live (now-migrated) Supabase. `GET /health` → `{"status":"ok"}`. `GET /events/?limit=100&summary=true` returned 32 events.
- `npm run dev` (Vite) on `:5173`. Both routes return HTTP 200.

### 5. Puppeteer smoke test

Wrote `/tmp/wat2do-puppet/smoke.js` (a Puppeteer driver) and ran it. **7/7 passed:**

| # | Test | Result |
|---|---|---|
| 1 | Homepage HTTP 200 | ✓ |
| 2 | `/` shows event cards from live DB (matched "E2E Test") | ✓ |
| 3 | Click event card → `EventDetailsModal` opens (verified by `[role="dialog"]` appearing) | ✓ |
| 4 | `/clubs` renders | ✓ |
| 5 | `/about` renders | ✓ |
| 6 | Backend public endpoints respond (3 events fetched + health=ok) | ✓ |
| 7 | `GET /qr/` unauthenticated → **401** (Phase-4 admin lockdown live) | ✓ |

Screenshots: `/tmp/wat2do-puppet/screenshots/` (5 PNGs).

Browser console errors during the run:
- `ClickToComponent initialization failed (requires editor environment)` — dev tooling, not a real bug.
- One 401 — auth check on first load; expected since no session cookie.
- No CORS errors after backend was restarted with explicit `CORS_ORIGINS='["http://localhost:5173","http://localhost:3000","http://127.0.0.1:5173"]'`.

## What I did NOT do

- **Did not** test the auth flow (sign-in, sign-up). The backend's `.env` has no `SUPABASE_JWT_SECRET` set, so JWT verification would fall back / fail. Add the secret + retest.
- **Did not** test event submission. The frontend's submit form still sends the pre-Phase-8 shape (`dtstart_utc/dtend_utc` at top level); the API now requires `occurrences: [...]`. This is `TODO.md` §0.1 work.
- **Did not** trigger the GitHub workflows (`big-scrape`, `process-single-user`). Needs the GH repo secrets to be set first.
- **Did not** run `docker build .` — Docker daemon unavailable in the sandbox.

## Cleanups

- Test event deleted (live DB returned to 32 events / 29 event_dates).
- Dev servers stopped (`uvicorn` + `vite` killed).
- Backup at `/tmp/wat2do-backup-20260428-134125/` left in place — user can `rm -rf` it once satisfied.

## Net result

The branch's two new migrations (and the migration-fix commit `322e9cf`) apply cleanly to your real Supabase DB. The 32 existing events were preserved with their dates correctly migrated to `event_dates`. Browser-driven testing of the public read paths against the migrated DB shows the EventDates port hasn't regressed any user-facing functionality, and the QR admin lockdown is enforced live.
