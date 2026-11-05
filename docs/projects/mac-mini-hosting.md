# Hosting wat2do: the Mac mini and AWS

Started 2026-11-03.
Tony asked to move all hosting off AWS onto the Mac mini, keeping only email (SES) on AWS, after the October AWS bill.
Production moved onto the Mac on 2026-11-05.
The Mac's home uplink is slow (about 14 Mbps), so pages were slow; the website moved to Vercel the same day, and then Tony decided to put the website and media in the wat2do AWS account (291667884807) instead, with the Mac staying the server.

## Target

`wat2do.io`, `www` and `*.wat2do.io` (every school) are CloudFront, with DNS-only CNAMEs in Cloudflare.
`api.wat2do.io` goes through the Cloudflare Tunnel to the Mac, where nothing listens on a public interface.
`infra/terraform/web` defines everything on AWS; its state is in the bucket `wat2do-terraform-state-291667884807`.

| Piece | Where |
|---|---|
| Website | Next on Lambda, built by OpenNext (`frontend/open-next.config.ts`): `wat2do-web-server` (streaming function URL), `wat2do-web-image` (`/_next/image`), `wat2do-web-revalidation` (SQS) and `wat2do-web-warmer` (every 5 minutes) |
| Static files | `wat2do-web-291667884807/_assets` (`/_next/*` and every top-level entry of `frontend/public`) |
| Feed snapshots | Next's data cache: entries in `wat2do-web-291667884807/_cache`, tag revalidation times in DynamoDB `wat2do-web-next-tags` |
| Media | S3 `wat2do-media-291667884807`, keys `<bucket>/<file>`, served at `https://wat2do.io/media/<bucket>/<file>`; the API and ingestion write it through `STORAGE_BUCKET_NAME` |
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
| AWS access from the Mac | IAM user `wat2do-api` (SES send and the media bucket), whose key is in `~/wat2do-data/config/backend.env`; IAM user `wat2do-web-deploy` (the web bucket, the functions' code, CloudFront invalidations), AWS CLI profile `wat2do-deploy` |
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
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -s cloudflare-api-token -w)"
terraform init
terraform apply -var-file="$HOME/wat2do-data/config/web.tfvars"
```

The default AWS CLI profile (`tony-cli`, administrator) runs Terraform; the deploy user cannot.
The certificate's validation records are Terraform's; the site's own Cloudflare records (`wat2do.io`, `www`, `*` as DNS-only CNAMEs to the distribution, `api` to the tunnel) are set in Cloudflare.

### Visitor addresses

Per-visitor limits (sign-in codes, reports, interaction caps, QR scan hashes) need the visitor's address, and the API trusts `X-Wat2Do-Viewer-Ip` only from loopback (`backend/core/client_ip.py`, `rust/src/api/client_ip.rs`), where Caddy is its only caller.
CloudFront's viewer-request functions set `X-Wat2Do-Viewer-Ip` from the connection, replacing whatever the visitor sent, and the API origin adds `X-Wat2Do-Origin-Verify` (`origin_verify_secret`).
On `api.wat2do.io`, Caddy keeps `X-Wat2Do-Viewer-Ip` only when `X-Wat2Do-Origin-Verify` matches its `ORIGIN_VERIFY_SECRET` (`~/wat2do-data/config/caddy.env`), and strips the secret before the API; any other request gets `CF-Connecting-IP`, whatever it sent.
Server rendering never calls the API on a visitor's behalf (its reads are public snapshots and details), so its requests carry no visitor address.

### Discovery snapshots

Each school's events, positions, clubs and branding, plus the school directory and the banner, is one `unstable_cache` entry in Next's data cache, shared by every function instance and deployment.
The backend's notices (`EVENT_FEED_REVALIDATION_URL`, `POST /api/revalidate-events`) mark a snapshot stale; the next read still gets the old copy and rebuilds it through the API in the background, and so does a read of a snapshot older than `refresh_interval_seconds` (`backend/controlbox/discovery_cache.json`).
CloudFront caches `/api/discovery` for `cdn_ttl_seconds` per school and resource.

## Moving from Vercel to AWS (2026-11-05)

1. `terraform apply` (above) creates everything; the functions start with a placeholder.
2. Copy media into the bucket with its headers: `aws s3 sync ~/wat2do-data/media s3://wat2do-media-291667884807/ --cache-control 'public, max-age=31536000, immutable'`, with `.svg` files again with `--content-type image/svg+xml --content-disposition attachment`.
3. Create the two IAM users' access keys: `wat2do-api`'s goes in `backend.env` (replacing `wat2do-ses-sender`'s) with `STORAGE_BUCKET_NAME=wat2do-media-291667884807`, and `wat2do-web-deploy`'s is the AWS CLI profile `wat2do-deploy`.
4. Rewrite `web-build.env` to the two settings above, then deploy the branch's website with `deploy.sh`'s upload steps and check it through CloudFront before any DNS change (`curl --resolve wat2do.io:443:<CloudFront address>`).
5. Point `wat2do.io`, `www` and `*` in Cloudflare at the distribution's domain, DNS-only.
6. Merge; the deploy job deploys the same commit, and `install.py io.wat2do.caddy io.wat2do.api` reloads Caddy (now API-only) and gives the API its 30 second stop timeout.
7. Copy media written since step 2 once more, then delete `~/wat2do-data/media`, `~/wat2do-data/discovery-cache`, `web.env`, the `io.wat2do.web` job, the Vercel project and the IAM user `wat2do-ses-sender`.

## Status

- [x] Cutover to the Mac (2026-11-05).
- [x] Teardown of the old AWS account 058264255918 (2026-11-05): every wat2do resource is deleted; the account also holds unrelated sobaii resources.
- [x] SES in the wat2do AWS account 291667884807.
- [ ] Website and media on AWS (branch `aws-frontend`), then the move above.
- [ ] Cache rules for the tunnel (skipped for now).
- [ ] LaunchDaemons so the API starts at boot without a login (needs Tony's admin password once).

## Notes for other sessions

- Browsers never call `api.wat2do.io` directly, so cookies (`Domain=.wat2do.io`, path `/api/auth/refresh`), CORS and the Google sign-in callback (`https://wat2do.io/api/auth/google/callback`) are unchanged.
- The website reads one API setting, `API_URL` (default `http://127.0.0.1:8000` for local development).
