# Hosting wat2do: the Mac mini and AWS

Started 2026-11-03.
Tony asked to move all hosting off AWS onto the Mac mini, keeping only email (SES) on AWS, after the October AWS bill.
Production moved onto the Mac on 2026-11-05.
The Mac's home uplink is slow (about 7 to 14 Mbps), so pages were slow; the website moved to Vercel the same day, and then Tony decided to put the website in the wat2do AWS account (291667884807) and media on Cloudflare R2, with the Mac staying the server.
The aim is a site that is fast and costs close to nothing: nothing runs all the time in the cloud, media bandwidth is free, and a page view rarely reaches a function or the Mac.

## Target

`wat2do.io`, `www` and `*.wat2do.io` (every school) are CloudFront, with DNS-only CNAMEs in Cloudflare.
`api.wat2do.io` goes through the Cloudflare Tunnel to the Mac, where nothing listens on a public interface.
`infra/terraform/web` defines everything on AWS; its state is in the bucket `wat2do-terraform-state-291667884807`.

| Piece | Where |
|---|---|
| Website | Next on Lambda, built by OpenNext (`frontend/open-next.config.ts`): `wat2do-web-server` (streaming function URL), `wat2do-web-revalidation` (SQS) and `wat2do-web-warmer` (every 5 minutes); CloudFront keeps every page for `cdn_ttl_seconds` per school subdomain, so the server function renders a page about once a minute per school |
| Static files | `wat2do-web-291667884807/_assets` (`/_next/*` and every top-level entry of `frontend/public`) |
| Feed snapshots | Next's data cache: entries in `wat2do-web-291667884807/_cache`, tag revalidation times in DynamoDB `wat2do-web-next-tags` |
| Media | Cloudflare R2 bucket `wat2do-media` (`infra/terraform/web/r2.tf`), keys `<bucket>/<file>`, served at `https://media.wat2do.io/<bucket>/<file>` through Cloudflare's cache (free bandwidth); the API and ingestion write it through `STORAGE_ENDPOINT_URL`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` and `STORAGE_BUCKET_NAME`; old `wat2do.io/media/...` links redirect there |
| Images | Served as stored (`images.unoptimized`), never resized per view: every poster gets a WebP thumbnail at upload (`event-images/<stem>.thumb.webp`, `uploads.json`), which poster frames show (`frontend/src/shared/utils/media.ts`) |
| `/api/*` | CloudFront sends it straight to `api.wat2do.io` without the `/api` prefix, except Next's own `/api/discovery`, `/api/revalidate-events` and `/api/render-instagram-slide` |
| Visitor address | CloudFront sets `X-Wat2Do-Viewer-Ip` and the shared `X-Wat2Do-Origin-Verify` secret on every `/api` request |
| Edge to the Mac | `cloudflared` tunnel `wat2do-mac` to `http://127.0.0.1:8080` |
| Router | Caddy on 127.0.0.1:8080 (`infra/mac-mini/Caddyfile`): `api.wat2do.io` to the API on 8000 |
| API | `wat2do-api` (Rust) on 127.0.0.1:8000, running FastAPI on loopback as its child |
| Data API | PostgREST 14.5 on 127.0.0.1:3001 |
| Database | Postgres 17, data in `~/wat2do-data/postgres`, ICU en-US |
| Event change alerts | launchd timer every minute |
| Log pruning | launchd timer daily |
| Email | SES in AWS account 291667884807 |
| AWS access from the Mac | IAM user `wat2do-api` (SES send), whose key is in `~/wat2do-data/config/backend.env`; IAM user `wat2do-web-deploy` (the web bucket, the functions' code, CloudFront invalidations), AWS CLI profile `wat2do-deploy` |
| Spend alert | AWS budget `wat2do-monthly`: email at 80% of $30 actual and at a forecast above $30 |
| Process Notifications | the Mac's existing runner (`wat2do-macmini-browser`), since GitHub-hosted runners cannot reach a home Postgres |
| Scheduled emails, poster payouts, Instagram account stats | launchd timers running the deployed release |
| Deploys | a job on a second Mac runner (`wat2do-macmini-deploy`), below |

## Deploys

`infra/mac-mini/deploy.sh` runs for every push to `main`:

1. Builds the Rust binaries and the website (`open-next build`) in the persistent checkout `~/wat2do-build`.
2. Assembles `~/wat2do-data/releases/<sha>`, applies pending migrations, switches `current` and restarts the API; when the API fails its health check, `current` goes back to the previous release.
3. Only then uploads the website: static files and the data cache to the web bucket, each function's code, and a CloudFront invalidation of `/*`, then checks `/healthz` and a school's discovery snapshot.

Website build settings are in `~/wat2do-data/config/web-build.env` (`API_URL=https://api.wat2do.io`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).
The functions' settings and secrets are Terraform's (`~/wat2do-data/config/web.tfvars`, mode 0600), so a deploy only replaces code.
A new top-level entry in `frontend/public` needs its own CloudFront behavior, so the deploy stops until `terraform apply` has added it.

## Changing AWS

```sh
cd infra/terraform/web
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -s cloudflare-api-token-r2 -w)"
terraform init
terraform apply -var-file="$HOME/wat2do-data/config/web.tfvars"
```

The default AWS CLI profile (`tony-cli`, administrator) runs Terraform; the deploy user cannot.
The R2 bucket, `media.wat2do.io`, tiered cache, the CAA record and the certificate's validation records are Terraform's; the site's own Cloudflare records (`wat2do.io`, `www`, `*` as DNS-only CNAMEs to the distribution, `api` to the tunnel) are set in Cloudflare.

### Visitor addresses

Per-visitor limits (sign-in codes, reports, interaction caps, QR scan hashes) need the visitor's address, and the API trusts `X-Wat2Do-Viewer-Ip` only from loopback (`rust/src/api/client_ip.rs`), where Caddy is its only caller.
CloudFront's viewer-request functions set `X-Wat2Do-Viewer-Ip` from the connection, replacing whatever the visitor sent, and the API origin adds `X-Wat2Do-Origin-Verify` (`origin_verify_secret`).
On `api.wat2do.io`, Caddy keeps `X-Wat2Do-Viewer-Ip` only when `X-Wat2Do-Origin-Verify` matches its `ORIGIN_VERIFY_SECRET` (`~/wat2do-data/config/caddy.env`), and strips the secret before the API; any other request gets `CF-Connecting-IP`, whatever it sent.
Server rendering never calls the API on a visitor's behalf (its reads are public snapshots and details), so its requests carry no visitor address.

### Discovery snapshots

Each school's events, positions, clubs and branding, plus the school directory and the banner, is one `unstable_cache` entry in Next's data cache, shared by every function instance and deployment.
The backend's notices (`EVENT_FEED_REVALIDATION_URL`, `POST /api/revalidate-events`) mark a snapshot stale; the next read still gets the old copy and rebuilds it through the API in the background, and so does a read of a snapshot older than `refresh_interval_seconds` (`backend/controlbox/discovery_cache.json`).
CloudFront caches `/api/discovery` for `cdn_ttl_seconds` per school and resource.

## Lambda concurrency

A new AWS account may run only 10 Lambda functions at once (`aws lambda get-account-settings`).
On 2026-11-05 the first switch to CloudFront hit it within minutes: one school page started about 48 image resizes at once, and visitors got "concurrent invocation limit exceeded"; DNS went back to Vercel and a raise to 1,000 was requested (Service Quotas `L-B99A9384`).
Since then a page view needs no function at all (cached pages, stored thumbnails), and the switch waits for the raise and a concurrent load test.

## Moving from Vercel to AWS and R2

1. `terraform apply` (above) creates everything; the functions start with a placeholder.
2. Make the thumbnails for the stored posters: `backend/.venv/bin/python backend/scripts/make_event_image_thumbnails.py --media-dir ~/wat2do-data/media`.
3. Copy `~/wat2do-data/media` (with the thumbnails) into R2 at the same keys, with `Cache-Control: public, max-age=31536000, immutable` and the SVG `Content-Disposition`; it takes hours over the Mac's uplink.
4. Put the R2 key and `STORAGE_*` settings in `backend.env` and the runtime checkout's `.env`, and `wat2do-api`'s AWS key for SES.
5. Deploy the branch's website (`deploy.sh`'s upload steps) and load-test it through CloudFront before any DNS change (`curl --resolve wat2do.io:443:<CloudFront address>`).
6. Merge: the deploy job applies the migration that moves stored media URLs to `https://media.wat2do.io/`, deploys the API and the website, and `install.py io.wat2do.caddy io.wat2do.api` reloads Caddy (API-only) and gives the API its 30 second stop timeout.
7. Copy media written since step 3 once more, point `wat2do.io`, `www` and `*` in Cloudflare at the distribution's domain (DNS-only), then delete `~/wat2do-data/discovery-cache`, `web.env`, the `io.wat2do.web` job, the Vercel project and the IAM user `wat2do-ses-sender`.

## Status

- [x] Cutover to the Mac (2026-11-05).
- [x] Teardown of the old AWS account 058264255918 (2026-11-05): every wat2do resource is deleted; the account also holds unrelated sobaii resources.
- [x] SES in the wat2do AWS account 291667884807.
- [ ] Website on AWS and media on R2 (branch `aws-frontend`), then the move above.
- [ ] Cache rules for the tunnel (skipped for now).
- [ ] LaunchDaemons so the API starts at boot without a login (needs Tony's admin password once).

## Notes for other sessions

- Browsers never call `api.wat2do.io` directly, so cookies (`Domain=.wat2do.io`, path `/api/auth/refresh`), CORS and the Google sign-in callback (`https://wat2do.io/api/auth/google/callback`) are unchanged.
- The website reads one API setting, `API_URL` (default `http://127.0.0.1:8000` for local development).
