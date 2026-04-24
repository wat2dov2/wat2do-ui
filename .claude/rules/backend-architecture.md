# Backend Architecture (FastAPI / `backend/`)

> **Scope:** this document governs the **backend** codebase only
> (`backend/**`). The frontend uses a feature-sliced structure — see
> [`code-architecture.md`](./code-architecture.md). Do **not** apply the
> frontend's feature-based rules to `backend/`.

The backend is organized by **layer**, not by feature. This is intentional
and should not be refactored to match the frontend.

## Layout

```
backend/
├── main.py              # App instantiation, CORS, security headers, router auto-discovery
├── core/                # Cross-cutting primitives — no domain logic
│   ├── auth.py          #   JWT verification, dependency injection for users
│   ├── database.py      #   Supabase client factories (anon + service-role)
│   ├── tables.py        #   Supabase table name constants  ← single source of truth
│   ├── errors.py        #   User-facing error strings       ← single source of truth
│   ├── constants.py     #   Shared business constants (roles, statuses, limits)
│   ├── exceptions.py    #   Domain exceptions (NotFoundError, ValidationError, …)
│   ├── pagination.py    #   PaginationParams / PaginatedResponse / fetch_all_pages
│   └── …                #   rate_limit, cache, retry, sanitize, security_headers
├── schemas/             # Pydantic request/response models — one file per resource
├── services/            # Data access + business logic — one file per resource
│   └── recommender/     #   Sub-package for the recommendation engine
├── routers/             # HTTP endpoints — one file per resource, auto-discovered by main.py
├── tests/               # Mirrors routers/ and services/
├── jobs/                # Background / scheduled tasks
├── seeds/               # One-off data population scripts
├── scripts/             # Admin / ops utilities
└── supabase/            # Schema — migrations/*.sql + config.toml; owned by the Supabase CLI
```

There is no `models/` directory — the project uses Supabase as its data
layer, not an ORM. All table access goes through `core.database.get_sb()`.

## The four layers and what belongs in each

| Layer       | Responsibility                                   | Knows about HTTP? | Knows about DB? |
|-------------|--------------------------------------------------|-------------------|-----------------|
| `schemas/`  | Request/response validation, OpenAPI contract    | Yes (implicit)    | No              |
| `routers/`  | HTTP verbs, auth dependencies, pagination, rate limits | Yes         | No              |
| `services/` | Data access, business rules, domain exceptions   | No                | Yes             |
| `core/`     | Cross-cutting primitives with no resource concept | Maybe             | Maybe           |

**Dependency direction is top-down:** routers → services → core.
Services **never** import from routers. Services raise domain exceptions
(`NotFoundError`, `ValidationError`) — routers translate via `get_or_404`
and the global error handler.

## Service design: class vs. function

- **Default to function-based services** (e.g. `report_service.py`,
  `saved_event_service.py`). Each public function takes its dependencies
  as arguments and returns a typed response model.
- **Use class-based services** only when the service wraps an **external
  client** (storage, auth SDK, AI API) or has **per-instance tunable
  config**. Export a module-level singleton (`storage_service = StorageService(...)`)
  so callers don't re-instantiate it. Makes testability cleaner because
  callers can monkeypatch the singleton or inject a test double.

## Single sources of truth

Before hardcoding a string or number, check these files first:

| What                     | File                    |
|--------------------------|-------------------------|
| Table names              | `core/tables.py`        |
| 4xx error detail strings | `core/errors.py`        |
| Role / status literals   | `core/constants.py`     |
| Field length limits      | `core/constants.py` *(if reused)* or the schema file *(if not — underscore-prefixed)* |
| Pagination defaults      | `core/constants.py`     |
| Domain exceptions        | `core/exceptions.py`    |

Inline string literals for any of the above are a review-comment offense.

### Field-length / size constants: where do they live?

Two places, with a single rule for which:

1. **`core/constants.py`** — any limit that is referenced from more than
   one file, or that mirrors a DB column width likely to be reused
   elsewhere (e.g. `MAX_USERNAME_LENGTH`, `MAX_REPORT_REASON_LENGTH`).
   Public name, no leading underscore.
2. **Inside the schema file itself, with a leading underscore** — limits
   used by exactly one `schemas/<resource>.py` and nowhere else
   (e.g. `_MAX_QR_ID_LENGTH` in `schemas/qr_code.py`,
   `_PASSWORD_MAX_LENGTH` in `schemas/auth.py`). The underscore signals
   "module-private — do not import from elsewhere; if you need it, move
   it to `core/constants.py` first."

The rule is: **if a second module ever imports it, promote it to
`core/constants.py` and drop the underscore in the same change**. Never
leave a public-named constant file-private — that's the inconsistency
trap that ends up with half the codebase on one convention and half on
the other.

## Ownership convention

**One** ownership model for every per-user table: the owner column is a
`UUID` that FK's to `users.id` (the internal primary key). The column is
conventionally named `created_by` for resources that are created by one
user but may be moderated (events, clubs, qr_codes) and `user_id` for
resources that are strictly per-user (saved events, interactions,
credits, promotions, submissions, reports).

The old split — where `events.created_by` / `clubs.created_by` /
`qr_codes.created_by` stored the **Supabase auth id** (JWT `sub`) instead
of the internal `users.id` — was unified in the
`unify_created_by_to_internal_id` migration (2026-04-23). There is no
longer any auth-id-based ownership column in the schema.

### How to enforce ownership

- Router: use `db_user: UserResponse = Depends(get_db_user)`.
- For moderated resources (owner-OR-admin access), call
  `get_authorized_resource(fetcher, detail, db_user, owner_field="created_by")`
  (or `require_owner_or_admin(db_user, resource.created_by)` inline).
  The helper checks owner-id equality first, falls through to
  `db_user.role == 'admin'` for admins, raises 403 otherwise.
- For strictly-per-user resources, filter by owner in the service
  query: `.eq("user_id", str(db_user.id))`. This hides other users'
  rows from admins too — if admin moderation is needed, add a separate
  `/admin/*` endpoint.

### Why not the auth id?

`users.supabase_auth_id` still exists (we need it to map JWTs to users
during the auth dependency), but it's strictly an auth-layer detail.
Storing it in domain tables forced two parallel lookup paths (auth id
vs. internal id) and split the helper surface in half. Unifying on the
internal id gives us:
- One FK target for every per-user column (`users.id`).
- One comparison rule: `db_user.id == resource.owner_column`.
- Clean CASCADE / SET NULL semantics when a user is deleted.

## Auth dependency cheatsheet

| Dependency              | Returns                                          | Use when                                       |
|-------------------------|--------------------------------------------------|------------------------------------------------|
| `get_current_user`      | `AuthUser` dict — `{id, email, aud, role}`       | Auth only, no DB / ownership needed (rate-limit keys, rare) |
| `get_db_user`           | `UserResponse` — internal user row (fresh read)  | Default. You need the internal id, role, or any profile field |
| `get_admin_user`        | `UserResponse` — fresh row + admin-role enforced | Admin-only endpoints                            |
| `get_optional_user`     | `AuthUser \| None`                               | Endpoint has public + auth'd variants           |

`get_db_user` bypasses the user-service cache so role changes
(promotion / demotion) take effect on the very next request. `get_admin_user`
is a thin wrapper around it that 403s when `role != 'admin'`. Everyone
downstream — ownership helpers, `is_admin(db_user)`, rate-limiters —
operates on the same `UserResponse` shape.

## New table checklist

Every new table migration must include:

1. `CREATE TABLE IF NOT EXISTS …` (idempotent).
2. All CHECK constraints inline in the CREATE TABLE statement.
3. Foreign keys added via a guarded `DO $$ … END$$` block with a
   `pg_constraint` lookup (so re-runs are safe).
4. Indexes on every FK column and on any column you `.order()` by at
   read time.
5. **`ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;`** — this is
   mandatory. The backend talks to Postgres via the **service-role**
   key which bypasses RLS; enabling RLS with no permissive policies
   blocks the anon / authenticated roles from reaching the table
   directly. Forgetting this line exposes the table to any future code
   path that uses the anon client.
6. Add the table name to `core/tables.py` as a `Final` constant.
7. Add any user-facing 404 string to `core/errors.py`.

> **Copy the skeleton.** `backend/supabase/migrations/README.md`
> contains the full new-table migration template with every guard
> (idempotent CREATE, RLS enable, FK via `DO $$ … END$$`, indexes)
> pre-wired. Start from it rather than from a blank file — the RLS
> line in particular is easy to forget and invisible when it's missing.

## New router checklist

1. Create `backend/routers/<resource>.py` with `router = APIRouter(prefix="/<resource>", tags=["<resource>"])`.
2. `main.py` auto-discovers every module in `routers/` that exports a
   `router` attribute — **do not** edit `main.py` to wire it up.
3. Write the service in `backend/services/<resource>_service.py`.
   Default to function-based.
4. Write the schema in `backend/schemas/<resource>.py`. Use
   `Literal[...]` for enum-like fields so OpenAPI renders the enum and
   the generated TS types stay in sync.
5. Use `PaginationParams` + `paginated_response` for list endpoints.
   Never hand-roll `?page=` handling.
6. Write router-level tests in `backend/tests/routers/test_<resource>.py`
   using the `authenticated_client` / `admin_client` fixtures in
   `conftest.py`.

## Migrations

All schema changes live in `backend/supabase/migrations/*.sql`. The
Supabase CLI owns schema; the FastAPI runtime only reads/writes via
PostgREST. Run every CLI command from inside `backend/` so the CLI
finds both `./supabase/` and the `DATABASE_URL` in `.env`.

- Never edit an already-applied migration. Write a new one.
- There is no automatic down-migration. Rollbacks are forward migrations
  (`DROP TABLE IF EXISTS foo;`) — plan accordingly.
- File name format: `YYYYMMDDHHMMSS_descriptive_name.sql`.
- See `README.md` → "Database (Supabase CLI)" for workflow commands.

## Testing

Two layers, two harnesses:

### Router layer — `backend/tests/routers/`

Use `fastapi.testclient.TestClient` with auth dependencies overridden
via `app.dependency_overrides` (see `tests/conftest.py` →
`authenticated_client` / `admin_client`). Verifies HTTP contracts,
status codes, and authz. Does **not** exercise the SQL layer.

### Service layer — `backend/tests/services/`

Use the `fake_sb` / `patch_sb` fixtures in `tests/services/conftest.py`.
`FakeSupabase` records every builder-chain call (`.table`, `.eq`,
`.delete`, …) so a filter typo like `.eq("user_id", …)` drifting to
`.eq("owner_id", …)` fails loudly:

```python
def test_unsave_event_filters_by_user_id(fake_sb, patch_sb):
    patch_sb("services.saved_event_service")
    fake_sb.set_response(data=[{"id": "row-uuid"}])

    unsave_event("user-uuid", 42)

    fake_sb.eq.assert_any_call("user_id", "user-uuid")
    fake_sb.eq.assert_any_call("event_id", 42)
```

When adding a new service, write at least one test per public function
that asserts on the expected chain. The filter-name bug class is
invisible to router tests and only surfaces when a user notices "my
saved events disappeared" — cheap to catch here, expensive to catch
later.
