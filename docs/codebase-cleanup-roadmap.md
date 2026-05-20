# Codebase Cleanup Roadmap

## Summary

This roadmap keeps cleanup audit-first and backend-first. The goal is to make
the codebase easier to change without rewriting behavior in the same pass.

Current architecture should stay split by runtime:

- Backend: layered FastAPI structure in `backend/routers`, `backend/services`,
  `backend/schemas`, and `backend/core`.
- Frontend: feature-sliced React structure in `frontend/src/app`,
  `frontend/src/features`, and `frontend/src/shared`.

Baseline from the initial audit:

- Backend tests pass locally: `606 passed`.
- Backend CI now runs Ruff format, Ruff lint, mypy, and pytest.
- Frontend CI now runs `npm run check` before `npm run build`.
- The frontend worktree has existing dirty files, so backend cleanup should not
  rewrite frontend files until that work stabilizes.

First cleanup pass completed:

- Enabled Ruff import-order enforcement and applied the import sort.
- Moved the floating dock into `frontend/src/shared/ui`.
- Added an ESLint boundary to prevent new imports from the legacy
  `frontend/src/components` tree.
- Enabled frontend unused-local/unused-parameter checks and removed stale
  React default imports exposed by that setting.
- Narrowed admin and club-panel route wrapper props so route components only
  receive the data they actually use.
- Moved deployment and integration docs under `docs/`, converted `CLAUDE.md`
  into a small pointer to `AGENTS.md`, and removed generated cache docs.

Shared constants cleanup pass completed:

- Split the broad backend `core.constants` module into the
  `backend/core/constants/` package, grouped by domain while preserving the
  existing `from core.constants import ...` facade.
- Moved frontend promotion and credit package values from
  `shared/types/promotion.types.ts` to `shared/constants/promotions.ts`, with a
  compatibility re-export for existing callers.

Notification school/time helper cleanup pass completed:

- Kept `services.school_context` as the canonical owner for school
  canonicalization, user-school resolution, and school timezone lookup.
- Removed notification digest/rendering dependencies on private scheduling
  wrappers; scheduling now owns send-time decisions, while school context owns
  school lookup.
- Preserved the old private compatibility names on
  `services.notification_service` for callers/tests that still import the
  facade.

QR API ownership cleanup pass completed:

- Treated `frontend/src/shared/api/posters.api.ts` as the canonical home for
  QR poster list reads and backend-to-frontend poster normalization.
- Treated `frontend/src/shared/api/scans.api.ts` as the canonical home for QR
  scan reads and backend-to-frontend scan normalization.
- Migrated repo-local QR poster/scan read callers away from the
  `features/qrcode/api/qrcode.api.ts` compatibility re-exports while preserving
  those exports for existing public import paths.

Questions raised during cleanup:

- Notification tests were reaching into private helpers because
  `notification_service.py` mixed preference CRUD, delivery-log dedup,
  scheduling, digest composition, fanout, and rendering in one module.
- Future notification types should probably land as focused strategy modules
  rather than more functions in a single service file.
- `notification_service.py` is now a compatibility facade, but it still
  re-exports underscored helpers for tests; decide whether those helpers are
  intentionally supported test surface or should be imported from focused
  notification modules.
- `services.school_context` now owns school canonicalization, school timezone
  lookup, user-school resolution, and semester-end lookup for calendar,
  notification, and scraping callers.
- Notification scheduling still lets a verified email domain override an
  explicit profile school; decide whether that should remain the policy if
  cross-school users become common.
- Morning and weekly notification digests still filter events using the raw
  profile `school`, while scheduling timezone resolution and daily-new-events
  filtering use `services.school_context`. Decide whether all digest flows
  should share one school resolution policy.
- `services.notifications.schedule.ensure_aware_utc` is now the public helper
  used by notification digest code. If UTC normalization grows outside
  notifications, decide whether it belongs in a small core datetime helper
  instead of staying notification-specific.
- Academic calendar differences are still represented as constant tuples.
  Future school-specific date rules may need a strategy/module pattern rather
  than expanding `SCHOOL_SEMESTER_ENDS`.
- Calendar, wat2do, and notification modules still expose compatibility
  imports for school/time helpers; retire those facades only after callers
  have moved to `services.school_context`.
- Frontend route and language constants files also export small helper
  functions. Decide whether those helpers should move to `shared/utils` once
  their usage grows.
- QR feature API/helper compatibility re-exports for poster and scan reads no
  longer have repo-local callers; decide whether those exports are still needed
  as public import-path compatibility.
- Marketing still imports poster deletion from the QR feature API. Decide
  whether destructive poster actions should move into a shared poster API module
  after caller ownership is audited.
- Local `backend/models` and `backend/scraping` directories contain only
  ignored cache artifacts; they are not repo source.

## Backend Structure Audit

Keep the backend layered by responsibility, not by feature. The existing
`.claude/rules/backend-architecture.md` is the source of truth for this shape.

Immediate cleanup targets:

- Start mypy on the configured stable-core baseline in `backend/pyproject.toml`;
  widen that include set as service and router typing is cleaned up.
- Keep route paths and response models stable in the first cleanup batch.
- Keep `main.py` router auto-discovery; do not manually add router imports.
- Preserve services as the DB/business logic layer and routers as HTTP/auth
  wiring only.

Risks and follow-up audit notes:

- Pagination styles are mixed across routers:
  - Newer admin/internal lists use `PaginationParams` and
    `PaginatedResponse`.
  - Older public lists still use `skip`/`limit`.
  - Promotions use `offset`/`limit`.
- Some service modules are large enough to deserve later decomposition:
  `notification_service.py`, `recommendation_service.py`, `ai_service.py`,
  and `club_service.py`.
- Local imports used to avoid cycles should be reviewed after lint/type tooling
  is stable.
- `backend/.venv`, `__pycache__`, `.pytest_cache`, `models`, and `scraping`
  are workspace hygiene concerns. Ignored artifacts should not become PR
  content; empty legacy directories should be removed only in a dedicated
  cleanup change after confirming they are untracked and unused.

## Frontend Structure Audit

Frontend cleanup should follow backend enforcement after current frontend edits
are stabilized.

Follow-up targets:

- Reduce deep cross-feature imports by using feature `index.ts` barrels where
  they already exist.
- Split large components/hooks in later focused batches, especially QR asset
  generation, event card/modal flows, and shared UI primitives.
- Keep widening frontend type strictness after nullability mismatches are
  normalized; `noUnusedLocals` and `noUnusedParameters` are now enforced.

## Route And API Efficiency

Do not rename routes or change response shapes in the first cleanup batch.
Instead, maintain an endpoint matrix and use it to rank later refactors.

| Area | Current Shape | Pagination | Frontend Call Pattern | Cleanup Direction |
| --- | --- | --- | --- | --- |
| Events browse | `GET /events/` list of event summaries | `skip`/`limit` | Home/events store fetches summary list | Keep stable; later add stable ordering and server-backed pagination if browse volume grows. |
| Clubs browse | `GET /clubs/` list of clubs | `skip`/`limit` | Clubs page loads list | Keep stable; later align query names or add paginated envelope if needed. |
| Users admin | `GET /users/` admin list | `skip`/`limit` | Admin-only | Candidate for `PaginationParams` after generated types and callers are updated. |
| Reports admin | `GET /reports/` paginated envelope | `page`/`page_size` | `getPaginatedItems` loads all pages | Acceptable for admin; monitor result size. |
| Submissions admin | `GET /submissions/` paginated envelope | `page`/`page_size` | `getPaginatedItems` loads all pages | Acceptable for admin; monitor result size. |
| QR admin | `GET /qr/`, `GET /qr/scans` paginated envelope | `page`/`page_size` | Poster/scans helpers load all pages | Keep admin/internal; avoid using fetch-all patterns in public user flows. |
| Scraped events admin | `GET /scraped-events/` paginated envelope | `page`/`page_size` | Admin fetch-all | Acceptable for admin. |
| Promotions | `GET /promotions/` list response | `offset`/`limit` | Credit/promotion stores | Candidate for later pagination normalization. |

Generated OpenAPI files in `frontend/src/shared/generated` are intentional and
should be regenerated only through the existing generation script when backend
contracts change.

## Risk-Ranked Cleanup Batches

1. Backend enforcement and audit docs.
   - Add Ruff, mypy, and CI gates.
   - Keep behavior unchanged.
   - Verify with format check, lint, type check, and tests.
2. Backend route consistency audit.
   - Document pagination/auth/response shapes per endpoint.
   - Add focused router tests before changing any route behavior.
3. Backend service decomposition.
   - Split large services only around clear domain seams.
   - Avoid unrelated refactors while moving code.
4. Frontend architecture cleanup.
   - Move the legacy floating dock to the canonical UI location.
   - Replace cross-feature deep imports with existing public barrels.
   - Add frontend `npm run check` to CI.
5. Route/API efficiency improvements.
   - Convert only selected endpoints to a common pagination model.
   - Regenerate OpenAPI and frontend types in the same change.
   - Update callers and tests together.

## Verification Commands

Backend:

```bash
cd backend
python -m ruff format --check .
python -m ruff check .
python -m mypy .
python -m pytest -q
```

Frontend follow-up:

```bash
cd frontend
npm run lint
npm run type-check
npm run build
```
