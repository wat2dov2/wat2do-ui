# Hosting wat2do on the Mac mini

Started 2026-11-03.
Tony asked to move all hosting off AWS onto the Mac mini, keeping only email (SES) on AWS, after the October AWS bill.

## Target

Cloudflare (DNS, CDN, TLS, tunnel) sends every request for `wat2do.io` and `*.wat2do.io` through a Cloudflare Tunnel to the Mac.
Nothing on the Mac listens on a public interface.

| Piece | On the Mac |
|---|---|
| Edge | `cloudflared` tunnel to `http://127.0.0.1:8080` |
| Router | Caddy on 127.0.0.1:8080: `/media/*` from `~/wat2do-data/media`, everything else to Next on 3000 |
| Website | Next standalone server on 127.0.0.1:3000; it already proxies `/api/*` to 127.0.0.1:8000 |
| API | `wat2do-api` (Rust) on 127.0.0.1:8000, running FastAPI on loopback as its child |
| Data API | PostgREST 14.5 on 127.0.0.1:3001 (same settings as the ECS service) |
| Database | Postgres 17, data in `~/wat2do-data/postgres`, ICU en-US, same roles and passwords as RDS |
| Media | `~/wat2do-data/media/<bucket>/<file>` (`MEDIA_ROOT`), public URLs unchanged |
| Feed snapshots | `~/wat2do-data/discovery-cache` (`DISCOVERY_CACHE_DIR`) |
| Link previews | Next `ImageResponse`, no Lambda and no browser |
| Event change alerts | launchd timer every minute, replacing EventBridge |
| Log pruning | launchd timer daily, replacing pg_cron |
| Email | SES through a send-only IAM key |
| Process Notifications | the Mac's existing runner (`wat2do-macmini-browser`), since GitHub-hosted runners cannot reach a home Postgres |
| Scheduled emails, poster payouts, Instagram account stats | launchd timers running the deployed release |
| Deploys | a job on a second Mac runner (`wat2do-macmini-deploy`): build in a persistent build checkout, assemble `~/wat2do-data/releases/<sha>`, migrate, switch `current`, restart, health check, roll back on failure |

## Status

- [x] Media copied: 54,043 files in use (9.7 GB); 80,928 unused files deleted from S3 (recoverable 90 days).
- [x] Postgres 17 running locally; roles and database created; rehearsal copy from RDS matched every table.
- [x] PostgREST 14.5 and cloudflared installed.
- [ ] Code: local disk storage (branch `local-disk-storage`).
- [ ] Code: link previews through Next (branch `og-image-route`).
- [ ] Code: client IP from `CF-Connecting-IP`; workflows on the Mac runners; Mac deploy job (branch `mac-hosting`).
- [ ] Services on the Mac: Caddy, PostgREST, API, website, timers, second runner.
- [ ] Cloudflare: account, zone, API token in Keychain `cloudflare-api-token` (Tony), records checked against Route 53, nameservers switched at Name.com (Tony), tunnel and cache rules.
- [ ] Cutover: freeze RDS writes, final copy, deploy to the Mac, point DNS at the tunnel, check login and Process Notifications.
- [ ] Teardown: ECS, ALB, CloudFront, RDS, S3, Lambda, SQS, EventBridge, Secrets Manager, Route 53 (after a day or two on the Mac).
- [ ] LaunchDaemons so the site starts at boot without a login (needs Tony's admin password once).

## Notes for other sessions

- 2026-11-04: `infra/terraform/production/locals.tf` now escapes every dot in `CORS_ORIGIN_REGEX` (`^https://[a-z0-9-]+[.]wat2do[.]io$`).
  The Rust tests at `rust/src/api/cors.rs:155` and `rust/src/settings.rs:257` still use the old unescaped string.
- The `mac-hosting` branch moves `process-notification.yml` entirely onto the Mac runners and replaces its Secrets Manager read with `~/wat2do-data/config/backend.env`.
  It turns `scheduled-emails`, `monthly-poster-payouts` and `instagram-account-stats` into launchd timers that run the deployed release's binaries.
  Client IP moves from CloudFront's `x-wat2do-viewer-ip` to Cloudflare's `CF-Connecting-IP` in `backend/core/client_ip.py` and `rust/src/api/client_ip.rs`.
