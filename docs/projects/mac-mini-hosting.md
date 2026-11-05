# Hosting wat2do on the Mac mini

Started 2026-11-03.
Tony asked to move all hosting off AWS onto the Mac mini, keeping only email (SES) on AWS, after the October AWS bill.
Production moved onto the Mac on 2026-11-05.
The Mac's home uplink is slow (about 14 Mbps), so pages were slow, and Tony decided the same day to run the website (Next) on Vercel while the Mac stays the server.

## Target

Cloudflare (DNS, CDN, TLS) sits in front of everything.
`wat2do.io`, `www` and `*.wat2do.io` (every school) go to the website on Vercel.
`api.wat2do.io` goes through the Cloudflare Tunnel to the Mac, where nothing listens on a public interface.

| Piece | Where |
|---|---|
| Website | Vercel project `wat2do` in team `tonyqiu123s-projects` (Hobby), Root Directory `frontend` |
| Website to API | Next rewrites `/api/*` and `/media/*` to `API_URL` (`https://api.wat2do.io`); server code reads the API at the same `API_URL` |
| Visitor address | `frontend/src/proxy.ts` adds `X-Wat2Do-Viewer-Ip` and the shared `X-Wat2Do-Origin-Verify` secret to each `/api` request |
| Feed snapshots | Next's data cache on Vercel (`frontend/src/shared/services/discoveryCache.server.ts`), marked stale by the backend's revalidation notices |
| Image optimization | Vercel (`/_next/image`), reading `https://wat2do.io/media/...` |
| Link previews and carousel slides | Vercel (`og-image.png`, `/api/render-instagram-slide`) |
| Edge to the Mac | `cloudflared` tunnel `wat2do-mac` to `http://127.0.0.1:8080` |
| Router | Caddy on 127.0.0.1:8080 (`infra/mac-mini/Caddyfile`): `api.wat2do.io` serves `/media/*` from disk and everything else from the API on 8000; any other host goes to the Mac's own Next on 3000 (the rollback) |
| API | `wat2do-api` (Rust) on 127.0.0.1:8000, running FastAPI on loopback as its child |
| Data API | PostgREST 14.5 on 127.0.0.1:3001 |
| Database | Postgres 17, data in `~/wat2do-data/postgres`, ICU en-US, same roles and passwords as RDS |
| Media | `~/wat2do-data/media/<bucket>/<file>` (`MEDIA_ROOT`); public URLs stay `https://wat2do.io/media/...` |
| Event change alerts | launchd timer every minute, replacing EventBridge |
| Log pruning | launchd timer daily, replacing pg_cron |
| Email | SES through a send-only IAM key |
| Process Notifications | the Mac's existing runner (`wat2do-macmini-browser`), since GitHub-hosted runners cannot reach a home Postgres |
| Scheduled emails, poster payouts, Instagram account stats | launchd timers running the deployed release |
| Deploys | a job on a second Mac runner (`wat2do-macmini-deploy`): build in a persistent build checkout, assemble `~/wat2do-data/releases/<sha>`, migrate, switch `current`, restart, health check, roll back on failure, then `vercel deploy --prod` of the same checkout |

## The website on Vercel

`infra/mac-mini/deploy.sh` deploys every commit to Vercel production after the Mac's release is healthy, so the API and its migrations always go first.
It runs `vercel deploy --prod` (CLI pinned in the script) from the build checkout using the Mac user's own Vercel CLI login (`vercel login`, refreshed by the CLI), and Vercel builds `frontend/` there.
`.vercelignore` uploads only `frontend/` and `backend/controlbox/`, the one directory outside the Root Directory that the website imports.

Project settings, set once in the dashboard:

- Framework preset Next.js, Root Directory `frontend`, Node.js 22.x.
- "Include files outside the root directory in the Build Step" on, since `next.config.ts` and the app import `../backend/controlbox`.
- No Git repository connected, so every deploy comes from the Mac (a connected repository would build every push a second time).
- Domains `wat2do.io`, `www.wat2do.io` and `*.wat2do.io`.

Environment variables (Production, available to the build and at runtime; names only, never values in the repository):

| Name | Value or source |
|---|---|
| `API_URL` | `https://api.wat2do.io` (read at build time by the rewrites, so a change needs a redeploy) |
| `STORAGE_PUBLIC_BASE_URL` | `https://wat2do.io/media`, the origin the slide renderer may inline posters from |
| `EVENT_FEED_REVALIDATION_SECRET` | the same value as in `~/wat2do-data/config/backend.env` and `web.env` |
| `INSTAGRAM_SLIDE_RENDER_SECRET` | the same value as in `~/wat2do-data/config/backend.env` and `web.env` |
| `ORIGIN_VERIFY_SECRET` | the same value as in `~/wat2do-data/config/caddy.env` (`openssl rand -hex 32`, created once) |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | from `~/wat2do-data/config/web-build.env` (a public browser key) |

`APP_VERSION` is passed per deploy as the commit (`--build-env`), and Vercel sets `NODE_ENV` itself.
The PostHog variables in `web-build.env` are no longer read by the code.

### Visitor addresses

Per-visitor limits (sign-in codes, reports, interaction caps, QR scan hashes) need the visitor's address, and the API trusts `X-Wat2Do-Viewer-Ip` only from loopback (`backend/core/client_ip.py`, `rust/src/api/client_ip.rs`), where Caddy is its only caller.
Vercel overwrites `x-real-ip` with whoever connected to it, which for wat2do.io is Cloudflare's edge, so the proxy takes `CF-Connecting-IP` only when `x-real-ip` is one of Cloudflare's published ranges (`backend/controlbox/viewer_ip.json`); a request that reaches Vercel without Cloudflare is named by its own address.
The proxy runs only on `/api` paths that the rewrite sends to the API, and only when `ORIGIN_VERIFY_SECRET` is set.
On `api.wat2do.io`, Caddy keeps `X-Wat2Do-Viewer-Ip` only when `X-Wat2Do-Origin-Verify` matches its `ORIGIN_VERIFY_SECRET`, and strips the secret before the API; any other request gets `CF-Connecting-IP`, whatever it sent.
Server rendering never calls the API on a visitor's behalf (its reads are public snapshots and details), so its requests carry no visitor address.
When Cloudflare publishes new ranges, update `viewer_ip.json`; until then visitors arriving through the new ranges share Cloudflare's address in the limits.

### Discovery snapshots

Each school's events, positions, clubs and branding, plus the school directory and the banner, is one `unstable_cache` entry, which Vercel keeps in its shared data cache across instances and deployments.
The backend's notices (`EVENT_FEED_REVALIDATION_URL`, `POST /api/revalidate-events`) mark a snapshot stale; the next read still gets the old copy and rebuilds it through the API in the background, and so does a read of a snapshot older than `refresh_interval_seconds` (`backend/controlbox/discovery_cache.json`).
There is no startup readiness gate or warm-up worker; the deploy job's discovery check makes the first read.

### Limits to watch on Hobby

These are from Vercel's documentation on 2026-11-05 and were not measured on our traffic.

- Runtime cache: 1M read and 200K write units of 8 KB a month, after which Vercel pauses the cache for the rest of the month and every read rebuilds through the Mac's uplink.
  The largest events snapshot (utsg) is about 840 KB (105 units per read or write), and rebuilding every school once is about 19 MB (2,400 write units), so hourly rebuilds of every school alone would be about 1.7M write units a month.
  Only snapshots someone reads are rebuilt, but if the cache pauses, raise `refresh_interval_seconds` or move to Pro.
- One item may be at most 2 MB, so a school's events snapshot must stay under that.
- A request rewritten to an external origin (every `/api` call) must answer within 30 seconds.
- Image optimization and proxy (middleware) invocations count against Hobby's monthly allowances.
- Hobby is for non-commercial use.

## Rollout

Steps 1 to 4 come before this change merges, because its deploy job deploys to Vercel and fails without them.

1. Create `~/wat2do-data/config/caddy.env` (mode 0600) with `ORIGIN_VERIFY_SECRET=<openssl rand -hex 32>`.
2. Create the Vercel project with the settings and environment variables above, without domains yet.
3. Log the Mac user in to the Vercel CLI (`npx vercel login`) with an account in `tonyqiu123s-projects`.
4. In Cloudflare, add `api` as a proxied CNAME to `5f02d299-baa4-4862-8c4a-b50717a6098f.cfargotunnel.com` (the tunnel's wildcard ingress already sends it to Caddy).
5. Merge; the deploy job builds the Mac release and the first Vercel deployment.
6. Run `python3 ~/wat2do-data/releases/current/infra/mac-mini/install.py io.wat2do.caddy`, which moves Caddy to `bin/run-caddy` (reads `caddy.env`) and loads the `api.wat2do.io` site.
   Check `curl -sS https://api.wat2do.io/health` and one `https://api.wat2do.io/media/...` file.
7. Add the domains to the Vercel project.
   `wat2do.io` is registered in another Vercel team (`ericas-projects-4f2175b1`), so Vercel may ask for a `_vercel` TXT record, which goes in Cloudflare.
   The wildcard needs Vercel's certificate challenge delegated: NS records for `_acme-challenge` to `ns1.vercel-dns.com` and `ns2.vercel-dns.com` in Cloudflare.
8. Point `wat2do.io`, `www` and `*` in Cloudflare at `cname.vercel-dns.com` (or the value Vercel shows), proxied, SSL mode full; `api` stays on the tunnel.
9. In `~/wat2do-data/config/backend.env`, set `EVENT_FEED_REVALIDATION_URL=https://wat2do.io/api/revalidate-events` and `INSTAGRAM_SLIDE_RENDER_URL=https://wat2do.io/api/render-instagram-slide`, then `launchctl kickstart -k gui/$(id -u)/io.wat2do.api`.
10. Check login (code email and refresh), a school subdomain, an event upload, a poster image, a link preview, a carousel slide render, and that `api.log` shows real visitor addresses on sign-in requests.

Rollback: point `wat2do.io`, `www` and `*` back at the tunnel, and set the two URLs in step 9 back to `http://127.0.0.1:3000/...`; Caddy's catch-all site still serves the Mac's own Next.
Once Vercel is verified, remove the Mac's website: the `io.wat2do.web` job, `bin/run-web`, `web.env`, `web-build.env`, the Caddy catch-all site, and the Next build, assembly and health check in `deploy.sh`.

## Status

- [x] Media copied: 54,043 files in use (9.7 GB); 80,928 unused files deleted from S3 (recoverable 90 days).
- [x] Postgres 17 running locally; roles and database created; rehearsal copy from RDS matched every table.
- [x] PostgREST 14.5 and cloudflared installed.
- [x] Code: local disk storage, link previews through Next, client IP from `CF-Connecting-IP`, workflows on the Mac runners, Mac deploy job (merged through `mac-cutover`, PR #183).
- [x] Cloudflare (2026-11-04): account, zone `wat2do.io` (id 88ab65a8559126f8e62f8bcd7ad08b85, free plan), scoped API token in Keychain `cloudflare-api-token`, SSL mode full, tunnel `wat2do-mac` (5f02d299-baa4-4862-8c4a-b50717a6098f) running as `io.wat2do.cloudflared`.
- [x] Cutover to the Mac (2026-11-05).
- [ ] Website on Vercel (branch `vercel-frontend`), then the rollout above.
- [ ] Remove the Mac's website once Vercel is verified.
- [ ] Cache rules for the tunnel (skipped for now).
- [ ] Teardown: ECS, ALB, CloudFront, RDS, S3, Lambda, SQS, EventBridge, Secrets Manager, Route 53 (after a day or two on the Mac).
- [ ] LaunchDaemons so the site starts at boot without a login (needs Tony's admin password once).

## Notes for other sessions

- 2026-11-04: `infra/terraform/production/locals.tf` now escapes every dot in `CORS_ORIGIN_REGEX` (`^https://[a-z0-9-]+[.]wat2do[.]io$`).
  The Rust tests at `rust/src/api/cors.rs:155` and `rust/src/settings.rs:257` still use the old unescaped string.
- Browsers never call `api.wat2do.io` directly, so cookies (`Domain=.wat2do.io`, path `/api/auth/refresh`), CORS and the Google sign-in callback (`https://wat2do.io/api/auth/google/callback`) are unchanged.
- The website reads one API setting, `API_URL` (default `http://127.0.0.1:8000`, which the Mac's own Next uses); `NEXT_PUBLIC_API_URL`, `BACKEND_API_URL`, `API_REWRITE_URL` and `DISCOVERY_CACHE_DIR` in `web.env` and `web-build.env` are no longer read, and `~/wat2do-data/discovery-cache` can be deleted.
- The AWS Terraform still reads `storage_prefix`, `generation_retention_days`, `readiness_timeout_seconds` and `startup_grace_seconds` from `discovery_cache.json`; drop them with the teardown.
