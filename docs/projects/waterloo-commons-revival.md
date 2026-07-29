# Project: Automated Instagram Event Publishing

Status: consolidated into wat2do-v2 in July 2026.
Owner: Tony.

## Current architecture

The standalone `waterloo-commons` application has been retired.
Its public event submission path now lives at `wat2do.io/events/submit`.
Its human review workflow now lives in the role-protected Wat2Do admin panel at `wat2do.io/admin/instagram`.

The production workflow considers every active event added for the account's school.
Each eligible event must be added during the batch window and have an upcoming occurrence within the configured lead-time window.

At 9 AM America/Toronto, the private backend job refreshes expiring Instagram tokens and creates one batch per configured Instagram account.
The job sends event metadata to a text model, which returns the ordered IDs of up to nine interesting events.
It writes a factual caption and stores those event IDs in the review batch.

A batch stores only its scrape run, its copy, and the events on the carousel in order.
Slide images are not stored: they are generated from live event data at publish time, so the events table is the single source of truth for everything a slide shows.

An administrator can add, remove, and reorder slides, edit an event's own details, edit the cover copy and caption, save the draft, and explicitly approve publication.
Publication renders the carousel, uploads it through the Instagram Graph API carousel flow, and stores the published media ID.
The batch account key selects exactly one encrypted credential row before any container is created.

## Operating contract

Expected Instagram usernames are non-secret feature configuration stored in `backend/controlbox/instagram_publishing.json`.
Each account's validated user ID, current username, encrypted access token, expiry, and reauthorization state are stored in the service-role-only `instagram_publishing_accounts` table.
The application-layer encryption key is stored as `INSTAGRAM_TOKEN_ENCRYPTION_KEY` in the ignored local backend environment file and in AWS Secrets Manager for production.
The plaintext tokens are never stored in source, control-box files, logs, or client responses.
There is intentionally no account-management UI.

Manual imports use `backend/scripts/import_instagram_tokens.py`.
For every supplied token, the importer calls Instagram's `/me` endpoint and assigns the token by the returned username matched against the control-box account username.
The scoped user ID returned by `/me` is stored with the encrypted credential and is the only ID used to create and publish media.
It does not trust the human label in the import file.

The daily job refreshes healthy tokens within the configured lead window.
A successful refresh replaces the encrypted token and expiry.
A failed refresh marks only that account as requiring reauthorization, records a redacted error, and fails the scheduled workflow so the existing GitHub Actions and CloudWatch operator alert path fires.

The first carousel image is a collage of every selected event with the heading `NEW EVENTS AT {UNIVERSITY}` and the subtitle `Added to Wat2Do in the last 24 hours`.
Every following image represents one event.
The caption includes the canonical organization handle when available, local date and time, location, and a reminder that final details are available at `wat2do.io`.

The retired standalone Supabase schema, submission repository, template editor, and Vercel application are not part of the production path.
