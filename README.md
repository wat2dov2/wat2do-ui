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

Install Docker Desktop (with Compose v2), Python 3.11+, and Make.
Start Docker Desktop, then run from the repository root:

```bash
make dev
```

The development Compose file runs PostgreSQL 17 (`database`, preloading `pg_cron` and `pg_stat_statements` as production does) and the PostgREST data API (`data-api`).
It builds and starts the frontend and backend with source mounts and automatic reload.
Node and backend Python dependencies are installed inside their containers.
The first run downloads images and dependencies and can take several minutes.
Before the apps start, `scripts/migrate-database.sh` applies pending migrations from `backend/database/migrations`, and `backend/database/seed.sql` runs.
An empty local database is built from `backend/database/baseline.sql`, the production schema that `scripts/dump-schema-baseline.sh` dumps.
Until that file exists, a new local database cannot be built, because the oldest migrations name roles and functions (`anon`, `authenticated`, `auth.uid()`) that a plain PostgreSQL server does not have.
Ordinary code reloads do not rerun migrations or seeds.
The database listens on `127.0.0.1:55432` (`postgresql://postgres:postgres@127.0.0.1:55432/wat2do`) and the data API on `http://127.0.0.1:55433`.
The data API, like production's, has no anonymous role: it refuses any request without a token signed with its development secret (`PGRST_JWT_SECRET` in `docker-compose.dev.yml`).
The backend's token names `service_role`, which `backend/database/local-roles.sql` grants every table.

Open `http://uwaterloo.wat2do.localhost:3000` or `http://ulaval.wat2do.localhost:3000`.
Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for an IAM user allowed `ses:SendEmail` in the ignored `backend/.env` before starting.
Login codes and other app emails arrive in the recipient's real inbox through Amazon SES.
The default sender is `wat2do <notifications@wat2do.io>`; it must be a verified SES identity in `AWS_REGION`, or set `EMAIL_FROM` to your verified sender.
While the SES account is in the sandbox, recipients must be verified SES identities too.
Automated backend tests disable delivery and mock SES calls.
The development Compose file overrides the production database and media settings in `backend/.env`.
Keep an optional OpenAI key in that ignored file to test extraction.

| Command | Behavior |
| --- | --- |
| `make dev` | Start the database, migrate, seed, then start the data API and auto-reloading apps. |
| `make seed` | Rerun the single SQL seed against the running local database. |
| `make stop` | Stop every local container, preserving data and dependency volumes. |
| `make db-reset` | Require typing `RESET`, then drop and rebuild the local database from the baseline, migrations, and seed. Apps remain stopped; run `make dev` afterward. |

Run `make dev` again after changing dependencies or environment settings.
Use `docker compose -p wat2do-dev -f docker-compose.dev.yml logs -f` to inspect app logs.
Stop manually started frontend/backend processes before switching to this workflow; ports 3000 and 8000 must be free.
Never use Compose `down -v` unless intentionally deleting local data.
The regular `docker-compose.yml` remains the production-style image configuration, not the local startup entry point.

## Repeatable local demo data

### Development image storage

Uploaded images are files on disk, as in production.
`make dev` sets `MEDIA_ROOT` to the git-ignored `media/` folder at the repository root, one folder per bucket (`media/event-images/<uuid>.jpg`).
The Compose `media` service serves that folder at `http://localhost:55434/media`, the backend's `STORAGE_PUBLIC_BASE_URL`.
Delete files under `media/` to clear local uploads; the local database keeps their URLs.
Discovery snapshots are built on each request in development, since `DISCOVERY_CACHE_DIR` is unset.
Keep `OPENAI_API_KEY` in the ignored backend environment and restart the backend after environment changes.

### Shared local login configuration

Use `http://uwaterloo.wat2do.localhost:3000` and `http://ulaval.wat2do.localhost:3000` for campus browsing.
`make dev` supplies the shared cookie domain, local HTTP cookie settings, CORS origins, and refresh-cookie path through the development Compose configuration.
No manual cookie or database environment setup is required.
If switching from the old campus URLs, sign in once on the new campus URL.
All campus subdomains share the refresh cookie, just as production uses `.wat2do.io` with secure cookies.
Old `*.localhost` campus URLs do not share this cookie and should no longer be used.

With the local database running, use the same seed entry point:

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
`make db-reset` also runs this seed after rebuilding the database, but it deletes local data and is only for an intentional fresh start.

## Feature control boxes

Non-secret feature and algorithm tuning lives in one file per feature under [`backend/controlbox`](backend/controlbox).
These files are the single editable sources for event discovery and ISR, frontend cache policy, recommendations, morning-email selection, authentication lifetimes, club invitations, notification defaults, interaction behavior and abuse bounds, API rate limits, scraper behavior, email delivery, AI output size, admin pagination, public attendee previews, and Instagram publishing accounts.
The backend validates the complete directory at startup, rejects missing or unknown feature files, and rejects invalid values or conflicting limits, while the frontend imports only the feature files it needs at build time.
Environment-specific credentials, infrastructure sizing, database constraints, and UI constants intentionally stay with their owning systems.
Changes take effect after rebuilding the applications or restarting a scheduled Python job.

Campus-season event filters are configured in `backend/controlbox/event_discovery.json` under `campus_seasons`.
Definitions own translated labels and thematic classification guidance; each school's entry chooses its season IDs, adds school-specific prompt guidance, and supplies inclusive `start_date`/`end_date` display windows in that school's local timezone.
The initial windows cover fall 2026 and are editorial discovery periods anchored to the official calendar linked by each window's `source_url`, not claims that every day is an official campus event.
Add explicitly dated windows for later terms after checking that school's calendar; windows do not repeat automatically, and an empty window list keeps a season hidden.
The public school snapshot exposes labels and windows, while both extraction passes receive the school-specific prompt guidance.
Event content must establish the theme regardless of today's filter visibility; `campus_season_ids: null` means unreviewed and `[]` means reviewed with no match.
Existing event rows remain unreviewed until explicitly classified or processed again; the schema migration does not guess season tags from event dates.
Employer recruiting continues to use `employers_on_campus` independently of these seasonal filters.

## Operating playbooks

- [`docs/seo_playbook.md`](docs/seo_playbook.md) is the maintained source of truth for SEO rules, page-quality gates, prioritization, measurement, and implementation TODOs.

## Production deployment

Wat2Do serves the application from one private AWS ECS Fargate task in `ca-central-1`.
The task contains the Next.js frontend on port 3000 and the FastAPI backend on port 8000.
CloudFront is the public edge and an Application Load Balancer is the HTTPS origin.
The database is Amazon RDS for PostgreSQL 17 (database `wat2do`), which the backend reads and writes through our own PostgREST data API at `https://data.wat2do.io`.
Sign-in, sessions and access tokens are the backend's own (`backend/services/auth_service.py`).
Uploaded and ingested media are files under `MEDIA_ROOT`, one folder per bucket, which the web server serves at `STORAGE_PUBLIC_BASE_URL` (`https://wat2do.io/media`).
The web server, not the code, sends their immutable `Cache-Control` header and `Content-Disposition: attachment` for `.svg` files.
Discovery snapshots are files under the frontend's `DISCOVERY_CACHE_DIR`, which must sit outside `MEDIA_ROOT`; production refuses to start without it.
Each school's link preview is drawn by the frontend on request (`frontend/src/app/og-image.png/route.tsx`) with Next.js `ImageResponse`, from the school and its event feed, with no browser.
The encrypted Terraform state bucket and DynamoDB lock table remain in `us-west-2`; they do not affect Canadian application traffic.

Terraform is split into `infra/terraform/foundation` and `infra/terraform/production`.
Foundation creates the encrypted, versioned S3 state bucket, Route 53 zone, two ECR repositories, secret containers, and GitHub OIDC roles.
Production creates the VPC, private Fargate workload, RDS database, PostgREST data API service, the per-minute event change alerts schedule, CloudFront, certificates, logging, and alarms.

The first foundation apply intentionally starts with local state because the state bucket does not yet exist.
Temporarily move `infra/terraform/foundation/backend.tf` outside that directory for this one local apply, then restore it before state migration.
After it creates the bucket, immediately migrate state to S3 using the `foundation/terraform.tfstate` key and the `wat2do-terraform-state-lock` DynamoDB lock table.
Populate the two Secrets Manager secret values from protected local files, not from Terraform variables or committed `.tfvars` files.
Before switching registrar nameservers, inventory every current Vercel DNS record and add all non-application records to `foundation.tfvars`.

The first ARM64 frontend and backend images must be pushed to ECR by digest before the initial production apply.
Once production exists, pushes to `main` use GitHub OIDC to build both images, tag them with the full commit SHA, and update the ECS task definition.
Event and position ingestion runs through one database table, `public.ingestion_items`, with one row per Instagram post or directory page, run by the Rust binary `wat2do-ingest` (`rust/src/ingestion`).
Instagram notifications come from a physical Android phone running Automate, which triggers the `process-notification` workflow.
The workflow records exact post URLs in the notification ledger, expanding collapsed digests through the Mac's logged-in Brave worker, and a database trigger adds each post to `ingestion_items`.
An always-on processor on the Mac listens for the Postgres notification (`LISTEN ingestion_items`) that a trigger on the queue sends whenever a row is added or changes, and wakes at once.
Its fetcher reads each new post logged out, with no account or cookies (`rust/src/ingestion/fetch.rs`), and marks the row ready; a deleted post is marked gone.
Every 12 hours Claude Haiku directory agents (`wat2do-ingest scrape-directories`) read the official school directories listed in `public.directory_sources`, skip what is already handled or listed, and add finished event details as ready rows (`backend/services/ingestion/directory_prompt.md`).
For each ready row the processor runs a Claude Haiku agent (`claude -p`) that follows `backend/services/ingestion/prompt.md`, up to `parallel_agents` at once (`backend/controlbox/ingestion.json`); posts from one club never run at the same time.
The agent inserts, updates, cancels or reschedules events and positions itself through `psql` with the `wat2do_ingest_agent` login, which can only write events, event dates and positions.
Set its connection string as `INGEST_AGENT_DATABASE_URL` in `backend/.env`; the role is created by migration and its password is set out of band.
Finished rows stay as `done` or `not_event`, so no URL is processed twice, and the Mac keeps no queue of its own.
Install both LaunchAgents with `cd backend && cargo run --release --manifest-path ../rust/Cargo.toml --bin wat2do-ingest -- install-schedule`; the Mac must be on and signed in to Claude Code.
The processor logs to `~/.local/state/wat2do/ingestion/process.stderr.log` and the directory scrape to `directories.log` beside it.
Every 6 hours a Claude Haiku agent per competitor (Eventbrite, Meetup, Fable Social) searches the public web for complaints with only WebSearch and WebFetch (`backend/services/competitor_pain_points/prompt.md`).
X shows nothing logged out, so before the agents run the sweep reads X's Latest search results in its own Safari window, using an X login a person made in Safari, and hands those posts to each agent (`x_browser.py`); Safari needs Develop > Allow JavaScript from Apple Events, and a logged-out Safari only skips X.
Checked findings land in `public.competitor_pain_points`, deduplicated by link, and admins triage them on the Competitor pain points admin page; nothing ever replies or posts.
Competitors, sources and their allowed link hosts, and the schedule live in `backend/controlbox/competitor_pain_points.json`.
Install its LaunchAgent with `cd backend && .venv/bin/python jobs/find_competitor_pain_points.py install-schedule`, or run one sweep with `sweep`.
Once a day the outreach sweep finds the emails of unclaimed clubs that have events or positions on Wat2Do, so each can be invited to claim the page Wat2Do made for it.
It reads each new club's own directory page first, busiest clubs first, and keeps an address only when that page shows it for that club alone; for clubs still without an email, a few Claude Haiku agents a day search the public web with only WebSearch and WebFetch (`backend/services/outreach/prompt.md`), and code keeps an address only when it is printed on the page the agent cites.
Leads land in `public.outreach_leads`, one per club; the email and follow-up (`backend/services/outreach/claim_email.md`) are written from the club when the admin page reads them, and a lead moves to claimed once its club is claimed.
Each lead also gets a formality score out of 100, how official the club looks, from signals the sweep already read: a page in the school's club directory or a site of its own, its email's domain, how many events and positions it has listed, an Instagram account and a formal name, with confession and meme accounts capped (`backend/services/outreach/formality.py`, points in the control box).
On the Outreach admin page an admin opens each email as a filled-in Gmail draft and tracks its status, sorting by newest or most formal.
Nothing is sent automatically.
The sweep's limits, the sender and the club link live in `backend/controlbox/outreach.json`.
Install its LaunchAgent with `cd backend && .venv/bin/python jobs/find_outreach_leads.py install-schedule`, or run one sweep with `sweep`.
Every local agent runs through `backend/services/claude_code.py` (Python jobs) or `rust/src/claude.rs` (the ingestion binary), which pass no application secrets unless the caller supplies them.
Notifications and recommendation compute run on GitHub-hosted runners.
Queue a post by hand with `cd backend && cargo run --release --manifest-path ../rust/Cargo.toml --bin wat2do-ingest -- enqueue --school <slug> --url <post url>` (`status` shows the queue counts); `wat2do-browser retrieve` (Rust, `rust/src/bin/wat2do-browser.rs`) also accepts a profile, which the Brave worker lists before its posts are queued.
Profile-logo backfills and single-post media repairs remain separate Apify operator tools.
For a read-only live retrieval check, run `cd backend && python scripts/probe_instagram_post.py --url https://www.instagram.com/p/SHORTCODE/`.

## 🤝 Support

If you have questions or feedback, please reach out through the <a href="https://wat2do.io/about" target="_blank">About page</a> or add a <a href="https://github.com/wat2dov2/wat2do-ui/issues" target="_blank">GitHub issue</a>.

Enjoy discovering events!

## 💙 Funding

Wat2Do is proudly funded by the <a href="https://wusa.ca/about/your-money/funding/" target="_blank">**Student Life Endowment Fund (SLEF)**</a> of the Waterloo Undergraduate Student Association (WUSA).

<img src="frontend/public/SLEF Logo_Color Logo Name.png" alt="SLEF Logo" width="300"/>
