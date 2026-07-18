# Waterloo Commons Events

A standalone Waterloo Commons event submission, curation, feed, and post-generation application.
Next.js pages and API routes run on Vercel Functions, while Supabase hosts Postgres, curator authentication, and private image storage.

## Run locally

1. Use Node.js 22.x.
2. Run `npm ci`.
3. Start the isolated local stack with `supabase start --experimental` so the installed CLI enables the Auth hook.
4. Rebuild it from the checked-in migration with `supabase db reset`.
5. Run `supabase status -o env` and copy `API_URL`, `PUBLISHABLE_KEY`, and `SECRET_KEY` into `.env.local` as `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY`.
6. Add the remaining local values listed in the environment table below.
7. Run `npm run dev`.
8. Open `http://localhost:3002`.

The current ignored `.env.local` is configured for the local stack on this machine.
Run `supabase stop` when the local services are no longer needed.
Never commit `.env.local` or copy production secrets into it unnecessarily.

## Routes

- `/` is the public Waterloo Commons event submission form.
- `/feed` is the authenticated curator event feed.
- `/admin/review` is the authenticated curator review queue.
- `/admin/studio` is the authenticated free-form post Studio.
- `/auth/login` is the unlisted curator entry point for Supabase passwordless sign-in links.
- `/api/maintenance/submissions` is the authenticated daily maintenance target for expired uploads, retained upload-session records, and expired rate-limit rows.

## Submission workflow

The browser requests a short-lived, server-authorized upload and sends the cover image directly to the private Supabase Storage bucket.
The browser then sends a small JSON request that finalizes the event submission.
The server validates and normalizes the staged image, creates the pending database record, and removes abandoned or rejected staged objects.
This direct-upload design preserves the 10 MB image requirement without crossing [Vercel's 4.5 MB Function request limit](https://examples.vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

Form submissions are validated and converted directly into a Commons post and caption without requiring OpenAI.
Curators can inspect the generated Instagram asset, copy its details, edit it, export the PNG, and approve or reject the submission.
The free-form Studio uses OpenAI when a curator chooses to generate fields from pasted event information.

Supabase stores submissions in `commons_submissions` and images in the private `commons-event-images` bucket.
The repository module is the only database and storage boundary, and browser code never receives the Supabase secret key.
Cover images use short-lived signed URLs generated through the server-owned repository.
The normalized submission record keeps source provenance so future Wat2Do ingestion can enter the same review workflow.

## Production prerequisites

- A dedicated hosted Supabase project that is not shared with Wat2Do.
- A Vercel project dedicated to the `waterloo-commons` directory.
- A verified Resend sending domain and sender address.
- Repository secrets for the guarded GitHub Actions deploy job.

Supabase Free organizations allow only two active projects, can pause inactive projects, and do not include production backups, as described in the [Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
If the organization is already at its free-project limit, do not delete, pause, or repurpose another project without owner approval.
Use a dedicated Supabase Pro project for a production service that must not pause and must have managed backups.

## Production environment

Set these values in the Vercel project's Production environment.
Use Vercel Sensitive Environment Variables for every server-only value.
Do not attach the production Supabase project to unprotected Preview deployments.

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server | Dedicated hosted Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser and server | Hosted project's publishable key. |
| `SUPABASE_SECRET_KEY` | Server only, sensitive | Database and private Storage administration. Never use a `NEXT_PUBLIC_` prefix. |
| `OPENAI_API_KEY` | Server only, sensitive | Free-form curator Studio generation. |
| `REQUEST_FINGERPRINT_SECRET` | Server only, sensitive | High-entropy key used to derive non-reversible abuse-control fingerprints. Generate it independently. |
| `CRON_SECRET` | Server only, sensitive | High-entropy bearer secret for the submission maintenance route. Generate it independently. |

Submission and upload rate limits are reviewed code constants, not environment knobs.
Changing a limit requires tests, review, and a normal release.
Do not add Resend SMTP credentials to Vercel because Supabase Auth owns email delivery.

## Configure hosted Supabase

1. Create a dedicated project in the intended production organization and region.
2. From this directory, run `supabase link --project-ref <project-ref>`.
3. Run `supabase db reset` and `supabase db lint` locally before applying anything remotely.
4. Review pending migrations with `supabase db push --dry-run`, then apply them with `supabase db push`.
5. Set the hosted Auth Site URL to the final HTTPS origin.
6. Add only the exact `https://<origin>/auth/callback` redirect URL required by production.
7. Enable the `before_user_created` Postgres Auth hook that calls `public.hook_restrict_commons_curators`.
8. Confirm that `commons-event-images` is private, limited to 10 MB, and restricted to the supported image MIME types.
9. Retrieve the hosted project URL, publishable key, and secret key and place them directly into Vercel's Production environment.

Do not push the localhost Auth URLs from `supabase/config.toml` to a hosted project unchanged.
Use the Supabase dashboard or Management API for environment-specific hosted Auth URLs, then verify the saved values before sending a magic link.
Do not reuse the Wat2Do service-role or secret key.

### Configure Resend for Supabase Auth

Configure custom SMTP in Supabase Authentication settings with the existing verified Resend account:

- Host: `smtp.resend.com`
- Port: `465`
- Username: `resend`
- Password: the Resend API key
- Sender: a verified transactional address on the configured domain
- Sender name: `Waterloo Commons`

These values follow [Resend's Supabase SMTP configuration](https://resend.com/docs/send-with-supabase-smtp).
Keep the Resend credential in Supabase's SMTP settings, not in this app or Vercel.
If hosted Auth configuration is applied through the CLI, provide that password temporarily as `SUPABASE_AUTH_SMTP_PASS` from a secure shell or CI secret and never commit it.
Disable marketing-style click and open tracking for authentication mail.
Send a production magic link to an allowed curator and confirm delivery, callback origin, and session creation before launch.


## Configure Vercel

Create a new Vercel project with these settings:

- Root Directory: `waterloo-commons`
- Framework Preset: Next.js
- Node.js Version: 22.x
- Function Region: Montréal (`yul1`), colocated with Supabase Canada Central.
- Install Command: `npm ci`
- Build Command: `npm run build`
- Output Directory: framework default
- Production Branch: `main`
- Include source files outside of the Root Directory: enabled

The outside-source setting is required because the Commons poster reuses `frontend/src/shared/ui/badge-mask-paths.ts`.
The checked-in `vercel.json` registers the cleanup request for `05:00 UTC` every day.
When `CRON_SECRET` is configured, Vercel sends it as the cleanup request's bearer credential and the route rejects other callers.

Configure a stable Vercel production URL first.
If a custom hostname such as `commons.wat2do.ca` is assigned later, update the Supabase Site URL, callback allowlist, and smoke tests before directing traffic to it.

The GitHub Actions deploy job is the intended production deployment path.
Do not enable a second automatic production deployment from `main` in Vercel.

## Configure GitHub Actions deployment

Add these repository secrets after the dedicated Vercel project exists:

- `VERCEL_COMMONS_ORG_ID`
- `VERCEL_COMMONS_PROJECT_ID`
- `VERCEL_COMMONS_TOKEN`

The deploy job skips safely and emits a notice if any of the three values is missing.
The job triggers a remote Vercel production build from the repository root only after backend, frontend, and Commons checks pass on `main`.
Building on Vercel keeps the `sharp` native binaries matched to the Function runtime and includes the shared badge-mask source that lives outside the Root Directory.
Application secrets remain in Vercel and are not duplicated as GitHub repository secrets.

## Release procedure

1. Run every check in the root `PUSH_TO_MAIN.md` checklist.
2. Run `supabase db push --dry-run` and review the exact production migration plan.
3. Apply additive database migrations before deploying code that needs them.
4. Push the reviewed commit to `main` only after all checks pass.
5. Confirm the `Deploy Waterloo Commons to Vercel` job completes and record the deployment URL.
6. Run the production smoke tests below.
7. Watch Vercel Function logs, Supabase Auth and database logs, Storage errors, Resend delivery, and the next scheduled cleanup invocation.

Use expand-and-contract database changes.
Do not deploy a destructive migration in the same release that removes the last compatible application path.

## Production smoke tests

1. Confirm `/` loads over HTTPS and contains only the public submission experience.
2. Confirm anonymous requests to `/feed`, `/admin/review`, and `/admin/studio` redirect to `/auth/login`.
3. Confirm an unauthorized email is rejected without creating a Supabase Auth user.
4. Confirm an allowed curator receives a real Resend magic link and returns to the production origin.
5. Submit a valid event with a small image and another with an image close to 10 MB.
6. Confirm each image uploads directly to private Supabase Storage and each finalize request creates exactly one pending record.
7. Confirm invalid, mismatched, oversized, and abandoned images are rejected or cleaned up.
8. Open the review drawer, edit every field, copy the caption and details, export the image, and approve the event.
9. Confirm the approved event appears in the authenticated feed and the image URL is short-lived.
10. Generate a Studio post through OpenAI, sign out, and confirm protected pages are inaccessible again.
11. Invoke the maintenance route with and without the cron bearer secret and confirm only the authenticated request succeeds.
12. Inspect browser bundles and deployment logs to confirm server-only secrets never appear.

## Ongoing operations

Monitor `/` for basic HTTPS availability, but do not treat that static page as proof that Auth, Postgres, Storage, Resend, or OpenAI is healthy.
Alert on sustained Vercel 5xx responses and review Supabase database, Auth, and Storage errors alongside Resend delivery failures.
Confirm the `05:00 UTC` maintenance invocation succeeds every day.
Investigate growing staged-upload counts, consumed sessions older than seven days, or rate-limit rows older than two days before changing retention behavior.
Repeat the authenticated smoke path after dependency upgrades, secret rotation, domain changes, Supabase configuration changes, and Vercel rollback.

## Rollback and incident response

For an application-only regression, use the Vercel dashboard or `vercel rollback <deployment-url>` to restore the last known-good production deployment.
Run the smoke tests again after rollback.

Do not reverse a production database migration by editing migration history or running destructive SQL ad hoc.
Ship a reviewed forward-fix migration instead.
Use a Supabase backup restore only for a confirmed data-loss incident and only with owner approval.

If a secret may have leaked, rotate it at its owning provider, update Vercel or Supabase as appropriate, redeploy, revoke the old value, and inspect access logs.
Rotate the Supabase secret key, OpenAI key, fingerprint secret, cron secret, and Resend credential independently.

If uploads fail, stop public submission traffic before changing the private bucket or cleanup policy.
Do not make the image bucket public as a recovery shortcut.

## Curator access

Curator pages and APIs use Supabase Auth sessions plus the `commons_curators` allowlist.
The before-user-created Auth hook blocks non-curator emails before Supabase creates an account.
The initial migration adds `tonyqiu12345@gmail.com` as the first curator.
Add or remove curator emails through a reviewed migration.
