# Wat2Do 

<p align="center">
  <img src="frontend/public/wat2do-logo.svg" alt="Wat2Do Logo" width="180"/>
</p>

<p align="center">
  <a href="https://wat2do.io" target="_blank">
    <img src="https://img.shields.io/badge/Live%20Site-wat2do.io-blue?style=flat-square" alt="Live Site"/>
  </a>
  <a href="https://github.com/wat2dov2/wat2do-ui/actions">
    <img src="https://img.shields.io/github/actions/workflow/status/wat2dov2/wat2do-ui/ci-cd.yml?branch=main&style=flat-square" alt="GitHub Actions Status"/>
  </a>
</p>

<a href="https://wat2do.io" target="_blank">Wat2Do</a> is a web app to help you discover club events at the University of
Waterloo, scraped directly from Instagram by capturing all student club events within 10 minutes!

## ✨ Features

- **Browse, search, and filter events:** See upcoming and past events from campus clubs
- **Club directory:** Explore all clubs with links to their website/Instagram
- **Email newsletter:** Subscribe to get the latest events in your inbox, once daily

## Local development

Install Docker Desktop (with Compose v2), the Supabase CLI, Python 3.11+, and Make.
Start Docker Desktop, then run from the repository root:

```bash
make dev
```

Supabase manages the database, authentication, and API gateway.
The development Compose file builds and starts the frontend and backend with source mounts and automatic reload.
Node and backend Python dependencies are installed inside their containers.
The first run downloads images and dependencies and can take several minutes.
Pending local migrations and `backend/supabase/seed.sql` run before the apps start.
Ordinary code reloads do not rerun migrations or seeds.

Open `http://uwaterloo.wat2do.localhost:3000` or `http://ulaval.wat2do.localhost:3000`.
Set `EMAIL_PROVIDER_API_KEY` to your Resend key in the ignored `backend/.env` before starting.
Login codes and other app emails arrive in the recipient's real inbox.
The default sender is `wat2do <notifications@wat2do.io>`; your key must be authorized to send from that verified domain, or set `EMAIL_FROM` to your verified sender.
Automated backend tests disable delivery and mock Resend calls.
The workflow derives database credentials from local Supabase and overrides production database settings in `backend/.env`.
Keep optional OpenAI and development storage credentials in that ignored file to test extraction and uploads.
Do not put production storage credentials there.

| Command | Behavior |
| --- | --- |
| `make dev` | Start infrastructure, migrate, seed, and start auto-reloading apps. |
| `make seed` | Rerun the single SQL seed against the running local database. |
| `make stop` | Stop the app and Supabase containers, preserving data and dependency volumes. |
| `make reset` | Require typing `RESET`, then erase and reseed the running local database. Apps remain stopped; run `make dev` afterward. |

Run `make dev` again after changing dependencies or environment settings.
Use `docker compose -p wat2do-dev -f docker-compose.dev.yml logs -f` to inspect app logs.
Stop manually started frontend/backend processes before switching to this workflow; ports 3000 and 8000 must be free.
Never use `supabase stop --no-backup` or Compose `down -v` unless intentionally deleting local data.
The regular `docker-compose.yml` remains the production-style image configuration, not the local startup entry point.

## Repeatable local demo data

### Development image storage

Development uses the same private S3 and CloudFront storage service as production, with separate resources.
Run `python scripts/provision_development_storage.py --account-id 058264255918 --region ca-central-1` from `backend/` with your existing AWS credentials to provision or reconcile development storage.
The command verifies the account before writing and prints the three storage environment settings for `backend/.env`.
The bucket is `wat2do-development-assets-058264255918`; CloudFront distribution `E3SCZU2ECBSCDN` serves `https://d323wbcnju9x2b.cloudfront.net/media`.
Only upload public test images: CloudFront image URLs are publicly readable, while S3 itself blocks public access.
Versioning preserves replaced or deleted objects; no automatic expiration is configured.
These resources incur AWS storage and delivery charges and are independent of the local database.
Keep `OPENAI_API_KEY` in the ignored backend environment and restart the backend after environment changes.

### Shared local login configuration

Use `http://uwaterloo.wat2do.localhost:3000` and `http://ulaval.wat2do.localhost:3000` for campus browsing.
`make dev` supplies the shared cookie domain, local HTTP cookie settings, CORS origins, and refresh-cookie path through the development Compose configuration.
No manual cookie or database environment setup is required.
If switching from the old campus URLs, sign in once on the new campus URL.
All campus subdomains share the refresh cookie, just as production uses `.wat2do.io` with secure cookies.
Old `*.localhost` campus URLs do not share this cookie and should no longer be used.

With local Supabase running, use the same seed entry point:

```bash
make seed
```

This targets the local Docker database and does not reset it.
It also adds two event submissions, two claim requests, and two club submissions per school for Waterloo, Alberta, and Université Laval.
Search for `Demo` to find these synthetic moderation fixtures.
Rerunning preserves your approval/rejection decisions and does not duplicate the fixtures.
It also adds 40 Waterloo demo positions with varied role types and paid/unpaid values for testing scrolling and sticky listing controls at `/positions`.
Search for `Waterloo Demo` to isolate these fixtures; rerunning does not duplicate them or overwrite edits.
The seed adds upcoming hourly Waterloo events with images, two editable Instagram batches, and one simulated failed batch at `/admin/instagram`.
It also adds 48 hourly UAlberta events across today and tomorrow in `America/Edmonton`, with images and campus locations.
Choose UAlberta and search `Alberta Mock` to test date filters; titles and descriptions state the expected Edmonton start time.
The 22:00 and 23:00 events occur on the following calendar day in Toronto, making timezone boundary differences easy to spot.
Each new batch contains six events; other upcoming event IDs can be used to test adding slides.
Dates are relative to the seed run, and existing batches and carousel edits are preserved on reruns.
The demo batches use a fake Instagram ID and cannot publish with real account credentials.
Poster images use Picsum and require internet access.
The ULaval review batch contains six hourly events and leaves the cover body empty to exercise French defaults.
If today's fake ULaval batch has no eligible events left, rerunning the seed appends six upcoming hourly events without replacing existing slides.
Open today's `ulaval` batch at `/admin/instagram` and select the cover: expect `NOUVEAUX ÉVÉNEMENTS AUJOURD’HUI`, a French date, and `Voir les événements` regardless of your admin UI language.
Migration `20260911200000_fix_ulaval_language.sql` corrects the original migration's `laval` slug typo; the seed also maintains ULaval's French language.
The UAlberta batch named by its caption intro, `WAT-278 timezone regression`, contains two events tomorrow in Edmonton: 6 PM and 11:30 PM on the same date.
Their stored occurrence timezone is deliberately wrong (`America/Toronto`); Instagram slide payloads and captions must instead use the school's `America/Edmonton` timezone.
The old bug produced 8 PM and 1:30 AM the following day in September.
Inspect the generated Instagram output, not the drawer's generic event cards, which use their own display formatting.
The fake account cannot publish, and Picsum images are not accepted by the production slide renderer's storage allowlist; these fixtures support local data/payload checks without publishing.
Supabase also runs this seed after `supabase db reset`, but that command deletes local data and is only for an intentional fresh start.

## Feature control boxes

Non-secret feature and algorithm tuning lives in one file per feature under [`backend/controlbox`](backend/controlbox).
These files are the single editable sources for event discovery and ISR, frontend cache policy, recommendations, morning-email selection, authentication lifetimes, club invitations, notification defaults, interaction behavior and abuse bounds, API rate limits, scraper behavior, email delivery, AI output size, admin pagination, public attendee previews, and Instagram publishing accounts.
The backend validates the complete directory at startup, rejects missing or unknown feature files, and rejects invalid values or conflicting limits, while the frontend imports only the feature files it needs at build time.
Environment-specific credentials, infrastructure sizing, database constraints, and UI constants intentionally stay with their owning systems.
Changes take effect after rebuilding the applications or restarting a scheduled Python job.

## Operating playbooks

- [`docs/seo_playbook.md`](docs/seo_playbook.md) is the maintained source of truth for SEO rules, page-quality gates, prioritization, measurement, and implementation TODOs.

## Production deployment

Wat2Do serves the application from one private AWS ECS Fargate task in `ca-central-1`.
The task contains the Next.js frontend on port 3000 and the FastAPI backend on port 8000.
CloudFront is the public edge, an Application Load Balancer is the HTTPS origin, and Supabase remains the database, authentication, and object-storage provider.
An isolated, concurrency-limited Lambda captures each school event feed as a social-preview image every six hours, then stores the immutable JPEG in the existing S3 and CloudFront asset path.
The encrypted Terraform state bucket and DynamoDB lock table remain in `us-west-2`; they do not affect Canadian application traffic.

Terraform is split into `infra/terraform/foundation` and `infra/terraform/production`.
Foundation creates the encrypted, versioned S3 state bucket, Route 53 zone, three ECR repositories, secret containers, and GitHub OIDC roles.
Production creates the VPC, private Fargate workload, social-preview Lambda and queues, CloudFront, certificates, logging, and alarms.

The first foundation apply intentionally starts with local state because the state bucket does not yet exist.
Temporarily move `infra/terraform/foundation/backend.tf` outside that directory for this one local apply, then restore it before state migration.
After it creates the bucket, immediately migrate state to S3 using the `foundation/terraform.tfstate` key and the `wat2do-terraform-state-lock` DynamoDB lock table.
Populate the two Secrets Manager secret values from protected local files, not from Terraform variables or committed `.tfvars` files.
Before switching registrar nameservers, inventory every current Vercel DNS record and add all non-application records to `foundation.tfvars`.

The first ARM64 frontend and backend images, plus the x86-64 social-preview image, must be pushed to ECR by digest before the initial production apply.
Once production exists, pushes to `main` use GitHub OIDC to build all three images, tag them with the full commit SHA, update the ECS task definition, and update the Lambda image.
Scheduled directory scraping, notifications, and recommendation compute run on GitHub-hosted runners.
Instagram notifications resolve to exact post URLs, which the pending-media workers fetch from public Instagram embeds without Apify or Instagram credentials.
Single images and all available carousel slide images use the same parser; incomplete or unavailable content fails the claim rather than being marked successful.
Post timestamps are optional, and the notification digest expansion still needs its existing logged-in browser session.
Manual username lookups and profile-logo backfills remain separate Apify tools.
For a read-only live retrieval check, run `cd backend && python scripts/probe_instagram_post.py --url https://www.instagram.com/p/SHORTCODE/`.

## 🤝 Support

If you have questions or feedback, please reach out at <a href="https://wat2do.io/contact" target="_blank">wat2do.io/contact</a> or add a <a href="https://github.com/wat2dov2/wat2do-ui/issues" target="_blank">GitHub issue</a>.

Enjoy discovering events!

## 💙 Funding

Wat2Do is proudly funded by the <a href="https://wusa.ca/about/your-money/funding/" target="_blank">**Student Life Endowment Fund (SLEF)**</a> of the Waterloo Undergraduate Student Association (WUSA).

<img src="frontend/public/SLEF Logo_Color Logo Name.png" alt="SLEF Logo" width="300"/>
