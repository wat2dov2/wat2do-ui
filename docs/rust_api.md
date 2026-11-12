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

`/health` answers 200 only while the Python app also answers, so the deploy job's health check (`infra/mac-mini/deploy.sh`) and the development container's cover both processes.
If uvicorn exits, `wat2do-api` exits non-zero and launchd (`io.wat2do.api`, `KeepAlive`) restarts it.
On SIGTERM it stops accepting connections, finishes in-flight requests (`shutdown_drain_seconds`, 14), then sends SIGTERM to uvicorn, gives it `python_shutdown_seconds` (15) and exits 0, within 30 seconds (`api_server.json` keeps the two under 30).
Each server also runs the map location worker (`rust/src/map_locations.rs`): it looks up waiting `map_locations` rows with Nominatim, and `claim_map_location` lets only one lookup be outstanding across every server, so the app keeps to Nominatim's one request a second.
SIGTERM stops it with the server; a lookup cut short leaves its claim to lapse, and the place is tried again.

Rust routes behave exactly like FastAPI routes:

- the same CORS answers as Starlette's `CORSMiddleware` (`api/cors.rs`) and the same security headers (`api/security_headers.rs`);
- matching on the percent-decoded path, a 307 to the other trailing-slash form, and Starlette's 405 (`{"detail":"Method Not Allowed"}`, HEAD included, since FastAPI routes never accept HEAD) (`api/routing.rs`);
- the same error bodies (`api/errors.rs`) and FastAPI's 422 shape for invalid parameters (`api/validation.rs`).

Proxied responses get none of these from Rust: Python still adds its own.

The website reaches the API through CloudFront, which keeps any proxied response that says it may, by URL and host, and answers later requests from that copy, signed in or not.
So only a response that is the same for every visitor (no user, cookie or rate limit changes it) may say so: `cache_control::shared(body, &API_CACHE.<response>)` marks it with its policy in `controlbox/api_cache.json` (today the event stats and the constants).
Send no `Cache-Control` on any other response: CloudFront keeps none of those.

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
   | `Depends(get_current_user)` (`core/auth_tokens.decode_access_token`) | `CurrentUser` extractor (`auth::AccessTokens`, the public half of `AUTH_SIGNING_KEY`) |
   | `Depends(get_optional_user)` | `OptionalUser` |
   | `Depends(get_db_user)` | `DbUser` (`User`: id, email, role, school) |
   | `Depends(get_admin_user)` | `AdminUser` |
   | `Depends(get_club_owner_or_admin)` | `ClubOwnerOrAdmin` |
   | `require_owner_or_admin`, `get_authorized_resource` | `auth::require_owner_or_admin`, `auth::authorized_resource` |
   | `NotFoundError`, `AuthorizationError`, `ValidationError`, ... | `ApiError` variants (`api/errors.rs`) |
   | strings in `core/errors.py` | `api/messages.rs` (same names; a Python test checks they match) |
   | `Query(...)` and path parameters | `QueryParams`, `PathParams` and `Validator` (`api/validation.rs`) |
   | a Pydantic request body | `ValidatedJson<T>` |
   | a Pydantic body with constraints, validators or `exclude_unset` | `body::Body` (every issue in field order, `Input::Missing`/`Null`/`Given`; nested models and lists through `Body::list` and `nested_item`) |
   | a body route whose dependency could fail first (auth, a limiter) | `body::json_first` or `check_json_syntax` first: FastAPI decodes the JSON before its dependencies |
   | `EmailStr` | `email_address::normalize` |
   | `AwareDatetime`, `Literal`, `pattern`, `list[int]` query parameters | `Field::optional_aware_datetime`, `optional_choice`, `optional_pattern`, `Validator::query_ints` |
   | `datetime` (naive allowed), `float`, `bool \| None`, any-size `int` and `list[str]` query parameters | `Field::optional_datetime`, `optional_float`, `optional_bool`, `unbounded_int`, `Validator::query_list` |
   | pydantic's datetime and date output, `json.dumps` floats | `json::datetime`, `json::option_date`, `json::float`, `json::option_float_array`, `json::value` |
   | `get_client_ip(request)` for a limiter | `client_ip::ClientIp` |
   | `response.set_cookie`, `delete_cookie`, `request.cookies` | `cookies::set`, `cookies::delete`, `cookies::read` (Starlette's quoting and attribute order) |
   | `RedirectResponse(url, status_code)` | `routing::redirect` |
   | `background_tasks.add_task(email_service.send_safely, message)` | `email::send_in_background` |
   | `secrets.token_urlsafe(n)` | `secrets::token_urlsafe` |
   | `base64.urlsafe_b64decode` (with or without re-padding) | `text::python_b64decode`, `text::python_b64decode_repadded` |
   | `urlparse`, `urlsplit`, `urlencode`, `quote_plus`, repeated `unquote` | `crate::urls` |
   | signing our access tokens, refresh token rotation (`services/auth_service.py`) | `auth::AccessTokens::issue`, `next_refresh_token`, `auth::new_refresh_token`, `auth::sha256_hex`, `auth::revoke_sessions` |
   | `PaginationParams`, `paginated_response`, `fetch_all_pages` | `pagination::Pagination`, `Paginated`, `fetch_all_pages` |
   | `RateLimiter` | `rate_limit::RateLimiter` in a `LazyLock`, keyed by `state.trust.client_ip(...)` or the user id |
   | `get_client_ip` | `ProxyTrust::client_ip` (repeats uvicorn's proxy rewrite first) |
   | `sanitize_postgrest_value`, `parse_iso_datetime` | `text::sanitize_postgrest_value`, `text::parse_iso_datetime` |
   | `sanitize_svg`, `looks_like_svg` | `svg_sanitize` |
   | `file: UploadFile = File(...)` | `multipart::read_field` before any extractor (FastAPI reads the form before its dependencies, and a malformed one is a 400), then `multipart::required_file` with the other parameters' 422 issues |
   | `storage.validate_and_prepare`, `storage.upload_file`, `delete_file`, `path_from_url` | `storage::validate_and_prepare` (off the async threads: `routes::ai::prepare_upload`), `state.storage` |
   | `get_school_for_email` | `allowed_emails::AllowedEmailDomains` |
   | PostgREST table reads through `get_sb()` | SQL on `state.db`; wrap reads in `db::read_with_retry` |

   Mirror any new constant in `rust/src/constants.rs` and extend `backend/tests/test_rust_constants.py`.
   When the router's schemas are shared with routes still in Python (or the generated types must not change), commit FastAPI's operations and schemas for its paths as `rust/src/api/routes/<router>_openapi.json`, cut from `frontend/src/shared/generated/openapi.json` before the Python router is deleted, and list it in `api/contract.rs`: it replaces what utoipa generated, keeps FastAPI's method order for 405 `Allow` headers, and maps a suffixed path such as `/calendar/feed/{token}.ics` to the axum route `/calendar/feed/{token}`.
5. Port the Python tests to Rust tests next to the code, plus the edge cases you find.
   Statements whose correctness depends on Postgres itself (concurrent requests, conflicts, row locks) also get database tests, like `rust/src/api/routes/auth/database_tests.rs`.
   They run only when `WAT2DO_TEST_DATABASE_URL` is set, which CI's "Rust database tests" job does against a `postgres:17` service loaded with the baseline and every migration; a plain `cargo test` skips them, and agents never start a database on the Mac.
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
   "identity": {"id": "<users.auth_id>", "email": "admin@example.com"}},
  {"name": "refused POST", "method": "POST", "path": "/site-banner", "safe": true}
]
```

The harness gives both sides one throwaway `AUTH_SIGNING_KEY` for the run (it overrides any key in the environment and is never printed), and sends each case with an `identity` with the access token our auth would issue that user (`sub` = `id`, a fresh `session_id`, 15 minutes).
Each side then verifies the token itself, so authentication is compared too.
Use the `auth_id` of a real user so `DbUser` resolves the same row on both sides.
A case can also send its own `authorization` header, such as a token we did not sign.
Keep real ids and emails out of committed case files: commit placeholders (as in `rust/parity/clubs.json`) and substitute real identities in a local copy when you run it.
`json` sends a JSON body, `body` a raw text one and `body_base64` raw bytes (a multipart upload).
Only GET, HEAD and OPTIONS cases run unless a case is marked `"safe": true` or `--allow-writes` is given, and `--allow-writes` only runs when `DATABASE_URL` and `DATA_API_URL` are local.
The Rust side uses at most 2 connections, and each runs `SET default_transaction_read_only = on`, `statement_timeout = '10s'` and `idle_in_transaction_session_timeout = '15s'`, and checks the first with `SHOW` before any query.
The FastAPI side cannot be made read-only through PostgREST, so never mark a case safe if its Python handler could write.
The FastAPI lifespan is never started.

Run it against production with the Python router still in a reference checkout.
Production runs go one at a time (take the shared `parity.lock` first), with at most 20 iterations and no retry of a failed run; stop at the first timeout.
The Python side reads through the data API, whose role already has an 8 second statement timeout:

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

`--iterations 1000` also reports per-request latency for both stacks (mean, median, p90, p95, min, max), and `--json-out` keeps both sides' responses.

Write routes are never run against production, not even in a rolled-back transaction.
Prove them with Rust tests, plus a read-only replay of the write cases (no `--allow-writes`): each handler runs its reads for real and must stop at its first write statement with Postgres' 25006 (read-only transaction), which the API reports as a 502.
Every case must print `SAME`; explain any accepted difference in the PR.
Remove the reference worktree afterwards.

## Local development

`make dev` builds the backend image (Rust included) and runs `wat2do-api serve --reload`, so Python changes reload while Rust changes need `make dev` again.
The Rust server reads the compose `database` service directly (`DATABASE_URL` in `docker-compose.dev.yml`) and verifies the access tokens the local backend signs with the development `AUTH_SIGNING_KEY`.
To run Rust alone without Docker, use the parity harness or `cargo test`; agents never start servers on the Mac.

## Production

On the Mac mini, the deploy job (`infra/mac-mini/deploy.sh`) builds `wat2do-api` into each release, and the `io.wat2do.api` LaunchAgent runs it on 127.0.0.1:8000 from the current release (`infra/mac-mini/bin/run-api`), behind Caddy and the Cloudflare Tunnel.
The server reads every address from its environment (`DATABASE_URL`, `AUTH_SIGNING_KEY`, CORS and cookie settings), which `run-api` loads from `~/wat2do-data/config/backend.env`, so moving hosts only changes those values.
The backend image that `make dev` runs is built and smoke-tested by the "Backend image build" CI job on every pull request and push to `main`.
The server refuses to start when `AUTH_SIGNING_KEY` is missing or is not an EC P-256 private key.
On SIGTERM it stops accepting, lets in-flight requests and the emails they queued (login codes among them) finish within `shutdown_drain_seconds` (14), then stops the Python app.
Like uvicorn before it, `wat2do-api` reaps only its own child.

### Database connections

`wat2do-api` connects to `DATABASE_URL` exactly as given (production: the RDS database `wat2do` as `wat2do_owner`, with no pooler in between), so it runs wherever that address is reachable.
Its pool is small and bounded (`controlbox/api_server.json`): each process holds at most `database_connections` (3), opens them only when a query needs one (no minimum), closes them after `database_idle_seconds` (60) idle, and waits at most `database_acquire_seconds` (3) for a free one before answering 503 instead of queueing.
Every connection starts with `statement_timeout` set to `database_statement_timeout_milliseconds` (8000), the same limit the data API's role has, so a slow query fails the request instead of holding the database.
RDS allows 400 connections; the API's few sit next to PostgREST's pool, the ingestion processor's 6 and the scheduled jobs'.
When the last Python router is gone, replace the container health check command and the `python` runtime with the Rust binary alone.
