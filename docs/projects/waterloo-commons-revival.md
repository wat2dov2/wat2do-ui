# Project: Automated Instagram Event Publishing

Status: consolidated into wat2do-v2 in July 2026.
Owner: Tony.

## Current architecture

The standalone `waterloo-commons` application has been retired.
Its public event submission path now lives at `wat2do.io/events/submit`.
Its human review workflow now lives in the role-protected Wat2Do admin panel at `wat2do.io/admin/instagram`.

The production workflow uses events written by the Instagram scraper as its only input.
Each eligible event must have `ingestion_source = 'instagram_scraper'`, a Supabase-hosted source image, and an upcoming occurrence within the configured lead-time window.

At 9 AM America/Toronto, the private backend job creates one batch per configured Instagram account.
The job uses a vision-capable model to score visual quality, event excitement, audience appeal, and timing.
It selects up to nine events, writes a factual caption, and stores the review batch in Supabase.

A batch stores only its scrape run, its copy, and the events on the carousel in order.
Slide images are not stored: they are generated from live event data at publish time, so the events table is the single source of truth for everything a slide shows.

An administrator can add, remove, and reorder slides, edit an event's own details, edit the cover copy and caption, save the draft, and explicitly approve publication.
Publication renders the carousel, uploads it through the Instagram Graph API carousel flow, and stores the published media ID.

## Operating contract

Instagram business account IDs are non-secret feature configuration stored in `backend/controlbox/instagram_publishing.json`.
The shared access token is stored as `INSTAGRAM_ACCESS_TOKEN` in the ignored local backend environment file and in AWS Secrets Manager for production.
There is intentionally no account-management UI.

The first carousel image is a collage of every selected event with the heading `NEW EVENTS AT {UNIVERSITY}` and the subtitle `Added to Wat2Do in the last 24 hours`.
Every following image represents one event.
The caption includes the canonical organization handle when available, local date and time, location, and a reminder that final details are available at `wat2do.io`.

The retired standalone Supabase schema, submission repository, template editor, and Vercel application are not part of the production path.
