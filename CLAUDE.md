# CLAUDE.md

## Project Overview

**wat2do** — event discovery platform with a React (Vite) frontend and Python (FastAPI) backend backed by Supabase.

## Backend Architecture (`backend/`)

### Service Design: Classes vs Functions

Services that manage **stateful dependencies** (DB clients, storage clients, auth clients) or benefit from **dependency injection** for testing are class-based. Services that are pure data-access layers with no injectable state remain function-based.

**Class-based services** (instantiated as module-level singletons):
- `StorageService` (`storage_service.py`) — wraps Supabase storage client + bucket config
- `AuthService` (`auth_service.py`) — wraps auth client + DB client
- `RecommendationEngine` (`recommendation_service.py`) — injectable scoring strategies (content, collaborative, popularity, reranker) + tunable thresholds
- `ABTestService` (`ab_test_service.py`) — experiment config (name, variants, treatment ratio)

Each module exports a default singleton (e.g., `storage = StorageService(...)`, `engine = RecommendationEngine()`). Callers import the instance, not the class. Tests can monkeypatch methods on the instance or construct a new instance with test doubles.

**Function-based services** (stateless, thin DB wrappers):
- `user_service`, `event_service`, `club_service`, `saved_event_service`, `qr_code_service`, `interaction_service`
- `credit_service`, `submission_service`, `report_service`, `scraped_event_service`
- `recommender/` sub-modules (content_based, collaborative, popularity, reranker, evaluation)

These call `get_sb()` at invocation time and have no injectable state — making them classes would add ceremony with no benefit.

**When to make a new service class-based:**
- It holds a client/connection that should be injectable (for testing or swapping implementations)
- It has configuration that varies per instance (thresholds, feature flags, experiment params)
- It bundles related operations that share state across method calls

### Database Access

All DB access goes through the Supabase Python SDK (PostgREST over HTTP). No ORM, no direct PostgreSQL driver. `core/database.py` provides `get_sb()` which returns the service-role client (bypasses RLS).

### Row Level Security (RLS)

RLS is enabled on **every** public table with **no permissive policies**. The service-role key (used by `get_sb()`) bypasses RLS, so the backend has full access. Direct PostgREST access via anon or authenticated Supabase keys is blocked. Any new table **must** include `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` in its migration.

### Migrations

Schema changes use SQL migration files in `migrations/sql/`, run by `scripts/migrate.py` (psycopg2-based, not Alembic). The `schema_migrations` table tracks applied versions.

```bash
.venv/bin/python scripts/migrate.py status          # show applied/pending
.venv/bin/python scripts/migrate.py apply            # run pending migrations
.venv/bin/python scripts/migrate.py new "add foo"    # create new .sql file
```

Every migration for a new table must enable RLS at the end of the file. Requires `DATABASE_URL` in `.env` (Supabase connection string, transaction mode, port 6543).

**Note:** The legacy `migrations/versions/` directory contains old Alembic files that were never runnable (no SQLAlchemy models, no asyncpg driver). They are historical reference only — do not use Alembic.

### Auth & RBAC

Refresh tokens are stored in httpOnly cookies (`path=/auth`, `samesite=lax`). Access tokens are returned in JSON response bodies and stored in-memory on the frontend (never in localStorage). Bearer token validation via `get_current_user` / `get_optional_user` FastAPI dependencies in `core/auth.py`. The auth router (`routers/auth.py`) sets/clears the refresh cookie on login/signup/refresh/logout. Cookie config (`cookie_domain`, `cookie_secure`) is in `core/config.py`.

**Role-based access control:** The `users` table has a `role` column (`"user"` or `"admin"`, default `"user"`). Three auth dependencies in `core/auth.py`:

| Dependency | Use for |
|---|---|
| `get_current_user` | Any authenticated user (profile, own events, etc.) |
| `get_optional_user` | Public endpoints with optional personalization |
| `get_admin_user` | Admin-only endpoints (returns 403 if `role != "admin"`) |

`get_admin_user` looks up the DB user via `user_service.get_user_by_supabase_id` and checks the `role` column. **New admin-only routes must use `Depends(get_admin_user)`**, not `get_current_user`. Currently protected: `/ab/metrics`, `/submissions/*` (list/get/update/delete), `/reports/` (list/update), `/scraped-events/*`, `/users/` (list/get/delete).

### Error Handling

Global exception handlers are registered in `core/error_handlers.py` and catch unhandled `AuthApiError` (supabase_auth), `APIError` (postgrest), and generic `Exception`. Routes do **not** need try/except for these — the global handlers map them to proper HTTP responses with consistent `{"detail": "..."}` shape.

**When to catch locally instead:**
- Graceful degradation (e.g., return empty list if an optional table doesn't exist yet)
- Custom status code or message that differs from the global mapping
- Adding logging context specific to the operation

**Do not** add try/except → HTTPException for `AuthApiError` or `APIError` in new routes unless you need behavior different from the global handler. Do not catch generic `Exception` in routes — let it propagate to the global 500 handler.

**Never swallow errors silently.** Every `except` block in backend services must log the error with `log.warning(...)` or `log.error(...)` — even when falling back to a default value. Silent catches (`except Exception: pass`, `except APIError: x = None`) hide bugs and make state drift invisible. Pattern:

```python
try:
    result = some_operation()
except Exception as e:
    log.warning("Operation failed, falling back to default: %s", e)
    result = default_value
```

### API Type Generation

Frontend TypeScript types for backend request/response shapes are **generated from FastAPI's OpenAPI spec** — do not hand-write duplicate interfaces.

```bash
cd frontend && npm run generate-types
```

This runs `backend/scripts/export_openapi.py` (exports `openapi.json`) then `openapi-typescript` (generates `src/shared/generated/api-types.ts`). The convenience re-export file `src/shared/generated/index.ts` provides named types like `ApiEventResponse`, `ApiSubmissionResponse`, etc.

**When adding or changing a backend schema:**
1. Update the Pydantic model in `backend/schemas/`
2. Run `npm run generate-types` from `frontend/`
3. Import from `@/shared/generated` in frontend code — never redefine the shape manually

**When consuming backend responses in frontend code:**
- Import types from `@/shared/generated` (e.g., `import type { ApiPromotionResponse } from "@/shared/generated"`)
- Use a local type alias if the generated name is awkward: `type PromotionResponse = ApiPromotionResponse`
- Mapper functions (snake_case → camelCase) live in the feature's `*.api.ts` file, not in components

### Testing

Pytest with FastAPI `TestClient`. Auth mocked via `app.dependency_overrides`. Service methods monkeypatched on singleton instances.

## Frontend Architecture (`frontend/`)

Feature-based structure under `src/features/`. See `.cursor/hooks/ARCHITECTURE_ENFORCEMENT.md` for detailed frontend architecture rules.

### Error Handling (Frontend)

**Never use empty `.catch(() => {})`.** Every `.catch()` and `catch {}` block must log the error with `console.error("context:", err)` — even for fire-and-forget operations (optimistic updates, background syncs). Silent catches hide bugs and make state drift invisible.

```ts
// BAD
saveEventToBackend(eventId).catch(() => {});

// GOOD
saveEventToBackend(eventId).catch((err) => console.error("Failed to save event:", err));
```

Fallback behavior (returning defaults, redirecting) is fine — just log before falling back.

### localStorage Policy

Only device-specific preferences and auth session hints belong in localStorage. **Never** store auth tokens, backend-owned data, or user content in localStorage.

**Allowed keys:** `theme`, `userEmail`, `userProfile`, `viewMode`, `filterViewMode`, `i18n-language`, `notificationPreferences`, `privacyPreferences`

- `userEmail` / `userProfile` are caches for synchronous auth checks — backend is source of truth, refreshed on login.
- `theme` stores `"dark"` | `"light"` (via `StorageService`, so JSON-stringified). Read by `index.html` pre-React to prevent FOUC.
- Auth tokens: access token is in-memory only (`apiClient.ts`), refresh token is httpOnly cookie. `initializeAuth()` in `main.tsx` restores the session before React renders.
- Credits, promotions, saved events, admin data (submissions, reports, scraped events) are all backend-only — no localStorage.
