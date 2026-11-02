# Rust API server

The public API is moving from FastAPI (`backend/main.py`, `backend/routers`) to Rust (`rust/src/api`, binary `wat2do-api`) one router at a time.
Until the last router is ported, both run in the backend container.

## How requests flow

`wat2do-api serve` is the container's main process and listens on port 8000, where uvicorn used to.
It starts uvicorn on `127.0.0.1:8001` (`controlbox/api_server.json` `python_port`) as a child process.
A request whose path matches a Rust route is answered by Rust.
Every other request is proxied to the Python app unchanged: method, path and query, every header and cookie, streamed bodies (uploads are never buffered), status codes, redirects and every `Set-Cookie`.
Only hop-by-hop headers are dropped.
The proxy connects over loopback, which uvicorn trusts for `X-Forwarded-For` and `X-Forwarded-Proto`, so Python sees the same client and scheme as before.
A request from a peer uvicorn would not have trusted reaches Python with `X-Forwarded-For` set to that peer and no `X-Forwarded-Proto`, as if uvicorn had read the socket itself.

`/health` answers 200 only while the Python app also answers, so the ECS container health check (unchanged, `python -c ... /health`) covers both processes.
If uvicorn exits, `wat2do-api` exits non-zero and ECS replaces the task.
On SIGTERM it stops accepting connections, finishes in-flight requests (`shutdown_drain_seconds`), then sends SIGTERM to uvicorn (whose lifespan shutdown stops the map-location thread) and exits 0.
The Python app still owns the map-location thread (`main.py` lifespan) until that is ported.

Rust routes behave exactly like FastAPI routes:

- the same CORS answers as Starlette's `CORSMiddleware` (`api/cors.rs`) and the same security headers (`api/security_headers.rs`);
- matching on the percent-decoded path, a 307 to the other trailing-slash form, and Starlette's 405 (`{"detail":"Method Not Allowed"}`, HEAD included, since FastAPI routes never accept HEAD) (`api/routing.rs`);
- the same error bodies (`api/errors.rs`) and FastAPI's 422 shape for invalid parameters (`api/validation.rs`).

Proxied responses get none of these from Rust: Python still adds its own.

## Porting a router

Port one whole router (every path under its prefix) per change, so no path is served by both apps.
`backend/core/openapi.py` refuses to build the schema when a Rust route would capture a FastAPI path, including through the trailing-slash redirect.

1. Read the router, its service, schemas and tests, and every caller in `frontend/`.
2. Add `rust/src/api/routes/<router>.rs` and list it in `api/routes/mod.rs`.
   Write each handler with a `#[utoipa::path]` that copies FastAPI's `operationId`, `summary`, `description`, `tags`, responses and schema names from `frontend/src/shared/generated/openapi.json`, so the generated frontend types do not change.
   Response structs derive `Serialize` and `utoipa::ToSchema`, with fields in the Pydantic model's order.
3. Register the handlers in `rust_routes()` in `rust/src/api/mod.rs`, in the order FastAPI registered them.
4. Use the shared request core instead of writing your own:

   | Python | Rust |
   |---|---|
   | `Depends(get_current_user)` | `CurrentUser` extractor |
   | `Depends(get_optional_user)` | `OptionalUser` |
   | `Depends(get_db_user)` | `DbUser` (`User`: id, email, role, school) |
   | `Depends(get_admin_user)` | `AdminUser` |
   | `Depends(get_club_owner_or_admin)` | `ClubOwnerOrAdmin` |
   | `require_owner_or_admin`, `get_authorized_resource` | `auth::require_owner_or_admin`, `auth::authorized_resource` |
   | `NotFoundError`, `AuthorizationError`, `ValidationError`, ... | `ApiError` variants (`api/errors.rs`) |
   | strings in `core/errors.py` | `api/messages.rs` (same names; a Python test checks they match) |
   | `Query(...)` and path parameters | `QueryParams`, `PathParams` and `Validator` (`api/validation.rs`) |
   | a Pydantic request body | `ValidatedJson<T>` |
   | `PaginationParams`, `paginated_response`, `fetch_all_pages` | `pagination::Pagination`, `Paginated`, `fetch_all_pages` |
   | `RateLimiter` | `rate_limit::RateLimiter` in a `LazyLock`, keyed by `state.trust.client_ip(...)` or the user id |
   | `get_client_ip` | `ProxyTrust::client_ip` (repeats uvicorn's proxy rewrite first) |
   | `sanitize_postgrest_value`, `parse_iso_datetime` | `text::sanitize_postgrest_value`, `text::parse_iso_datetime` |
   | `sanitize_svg`, `looks_like_svg` | `svg_sanitize` |
   | `get_school_for_email` | `allowed_emails::AllowedEmailDomains` |
   | PostgREST table reads through `get_sb()` | SQL on `state.db`; wrap reads in `db::read_with_retry` |

   Mirror any new constant in `rust/src/constants.rs` and extend `backend/tests/test_rust_constants.py`.
5. Port the Python tests to Rust tests next to the code, plus the edge cases you find.
6. Regenerate the route inventory: `cargo run --bin wat2do-api -- openapi > ../backend/core/rust_openapi.json` in `rust/` (a Rust test fails while it is stale), then `npm run generate-types` in `frontend/` and check that `api-types.ts` only moves.
7. Run the parity harness (below) against production, read-only, with a reference checkout that still has the Python router.
8. Delete the Python router, its service, schemas and tests in the same change, and every import of them that no other Python code needs.

## Parity harness

`backend/scripts/api_parity.py` runs a list of requests through FastAPI's `TestClient` and through `wat2do-api replay` (the Rust router through tower's `oneshot`), both in process with no server, and compares status, headers (except `content-length`, `date` and `server`) and bodies.

A case file is a JSON list (see `rust/parity/pilot.json`):

```json
[
  {"name": "site banner", "path": "/site-banner"},
  {"name": "admin list", "path": "/clubs/?page=2", "headers": {"origin": "https://wat2do.io"},
   "identity": {"id": "<users.supabase_auth_id>", "email": "admin@example.com", "aud": "authenticated", "role": "authenticated"}},
  {"name": "refused POST", "method": "POST", "path": "/site-banner", "safe": true}
]
```

`identity` stands in for a verified token on both sides (`dependency_overrides` in Python, a fixed identity in Rust), because Supabase-signed tokens cannot be minted.
Use the `supabase_auth_id` of a real user so `DbUser` resolves the same row on both sides.
`json` sends a JSON body and `body` a raw one.
Only GET, HEAD and OPTIONS cases run unless a case is marked `"safe": true` or `--allow-writes` is given, and `--allow-writes` only runs against a local Supabase.
The Rust side's connections run `SET default_transaction_read_only = on` and check it with `SHOW` before any query (the pooler ignores `PGOPTIONS`).
The FastAPI side cannot be made read-only through PostgREST, so never mark a case safe if its Python handler could write.
The FastAPI lifespan, and with it the map-location thread, is never started.

Run it against production with the Python router still in a reference checkout:

```bash
git -C ~/Desktop/projects/2026/wat2do-v2 worktree add --detach /tmp/wat2do-ref origin/main
(cd rust && cargo build --release --bin wat2do-api)
cd backend
set -a; source ~/wat2do-runtime/backend/.env; set +a
export ENVIRONMENT=production \
  CORS_ORIGINS='["https://wat2do.io","https://www.wat2do.io","https://wat2do.ca","https://www.wat2do.ca"]' \
  CORS_ORIGIN_REGEX='^https://[a-z0-9-]+[.]wat2do.io$'
.venv/bin/python scripts/api_parity.py ../rust/parity/<router>.json \
  --python-backend /tmp/wat2do-ref/backend --rust-binary ../rust/target/release/wat2do-api
```

`--iterations 1000` also reports per-request latency for both stacks, and `--json-out` keeps both sides' responses.
Every case must print `SAME`; explain any accepted difference in the PR.
Remove the reference worktree afterwards.

## Local development

`make dev` builds the backend image (Rust included) and runs `wat2do-api serve --reload`, so Python changes reload while Rust changes need `make dev` again.
`DEV_DATABASE_URL` points the Rust server at the local Supabase Postgres.
To run Rust alone without Docker, use the parity harness or `cargo test`; agents never start servers on the Mac.

## Production

The backend image builds `wat2do-api` in a Rust stage and runs it as the non-root `wat2do` user on a read-only root filesystem.
The ECS task needs egress to Postgres on 5432 (`infra/terraform/production/security-groups.tf`).

### Database connection budget

`wat2do-api` reads Postgres through the pooler's session mode (5432), where every client connection pins a server connection, so its pool is small and bounded (`controlbox/api_server.json`).
Each task holds at most `database_connections` (3), opens them only when a query needs one (no minimum), closes them after `database_idle_seconds` (60) idle, and waits at most `database_acquire_seconds` (3) for a free one before answering 503 instead of queueing.
Production allows 60 connections, and about 33 are in use (PostgREST 11, Supavisor 8, realtime and internals about 14).
Rust services add the ingestion processor (6), directory runs (4 while running) and the hourly email job (a few, say 2), which is 12.
Two API tasks add 6, and a rolling deploy briefly runs four tasks, adding 12.
The worst case is 33 + 12 + 12 = 57 of 60, so raise `database_connections` only after PostgREST traffic has moved to Rust and the in-use count has dropped.
When the last Python router is gone, replace the container health check command and the `python` runtime with the Rust binary alone.
