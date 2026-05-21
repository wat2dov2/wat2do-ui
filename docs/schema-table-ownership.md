# Schema Table Ownership

Last audited: 2026-05-21.

This document separates actual duplicate/stale tables from tables that look
similar but serve different jobs. The backend is the only supported app path
for table access; React should call backend APIs, not Supabase tables directly.

## Current Tables And Views

| Name | Kind | Canonical owner | Role | Duplicate concern |
| --- | --- | --- | --- | --- |
| `users` | Table | `services.user_service` | App profile and role record keyed to Supabase auth users. | Keep. Not duplicated elsewhere. |
| `clubs` | Table | `services.club_service` | Admin-approved official club record; `created_by` is the current owner/approval link. | Keep. Owns club identity. |
| `events` | Table | `services.event_service` | Published event source of truth. `club_id` is canonical club ownership; `organization` remains response/display compatibility. | Keep. `organization` is intentionally redundant until legacy responses/history are audited. |
| `event_dates` | Table | `services.event_service` | Event occurrence dates for one-off and recurring/multi-date events. | Keep. Not a duplicate of `events`; it stores occurrences. |
| `events_listing` | View | DB migration + event/recommendation readers | Read-side view joining events to occurrence dates for list filtering and date ordering. | Keep. It is a compatibility/read model, not a second event table. |
| `event_submissions` | Table | `services.submission_service` | Normal-user event suggestions awaiting admin moderation. Approval publishes to `events` server-side. | Keep. It is a queue, not a published event table. |
| `user_saved_events` | Table | `services.saved_event_service` | Durable bookmark state. | Keep. Separate from interaction telemetry. |
| `reported_events` | Table | `services.report_service` | Moderation reports submitted by users. | Keep. No duplicate surface. |
| `user_interactions` | Table | `services.interaction_service` | Append-only behavioral signal for recommendations and activity scoring. | Keep. Not a bookmark table and not experiment telemetry. |
| `user_recommendations` | Table | `services.recommendation_service` + recommendation jobs | Materialized recommendation results used by the live endpoint before live top-up. | Keep while offline recommendation jobs exist; remove only if recommendations become online-only. |
| `ab_assignments` | Table | `services.ab_test_service` | Sticky user-to-variant assignment. | Keep. Not duplicate telemetry. |
| `ab_test_events` | Table | `services.ab_test_service` | Experiment impressions and clicks for CTR metrics. | Keep. Separate from general interactions. |
| `user_credits` | Table | credit RPCs + `services.credit_service` | Current credit balance. | Keep. Balance table, not ledger/history. |
| `credit_transactions` | Table | credit RPCs | Credit ledger/audit trail emitted by balance mutations. | Keep. Not duplicate of `user_credits`. |
| `event_promotions` | Table | `services.credit_service` | Active and historical promoted event placements. | Keep. `package` is legacy compatibility for a one-package v1 product. |
| `notification_preferences` | Table | `services.notifications.preferences` | Backend notification opt-in state. | Keep. Frontend local settings drift should be resolved later. |
| `notifications_log` | Table | notification delivery services | Delivery/dedup history for emails and notification jobs. | Keep. Log table, not preferences. |
| `qr_codes` | Table | QR/poster services | QR poster definitions and redirect targets. | Keep. Asset/redirect source of truth. |
| `qr_code_scans` | Table | QR scan services | Scan telemetry for QR posters. | Keep. Separate from poster definitions. |
| `workflow_runs` | Table | `services.workflow_run_service` + scrape jobs | Operational tracking for ingestion/workflow runs. | Keep. Replaces stale per-event scrape table. |
| `club_integrations` | Table | `services.club_service` | Saved club integration config for visible club-panel UI. | Keep until product decides whether integrations are real or placeholder-only. |

## Retired Redundant Tables

These tables are intentionally removed by forward migrations and should not
come back without a new product decision.

| Name | Why retired |
| --- | --- |
| `scraped_events` | Scraper ingestion writes to `events`/`event_dates`; `workflow_runs` is enough for operational tracking. |
| `user_event_rsvps` | No frontend RSVP feature exists, so the backend/table surface was removed. |
| `alembic_version` / `schema_migrations` | Historical migration bookkeeping leftovers removed by the Supabase sync migration. |

## Duplicate-Looking Pairs

- `events` + `events_listing`: table plus read-side view.
- `events` + `event_dates`: event identity plus event occurrences.
- `events` + `event_submissions`: published catalog plus moderation queue.
- `clubs.club_name` + `events.organization`: canonical club identity plus legacy event response/display string.
- `user_saved_events` + `user_interactions`: durable saved state plus behavioral event stream.
- `user_interactions` + `ab_test_events`: recommendation/product activity plus experiment measurement.
- `ab_assignments` + `ab_test_events`: sticky assignment plus emitted experiment events.
- `user_credits` + `credit_transactions`: current balance plus ledger.
- `notification_preferences` + `notifications_log`: settings plus delivery history.
- `qr_codes` + `qr_code_scans`: QR asset/redirect definition plus scan telemetry.

## Follow-Up Decisions

- Decide whether approving a normal-user submission should notify the submitter
  once notification preferences are fully wired.
- Decide whether `events.organization` can become a derived/display-only field
  after all create/update paths prefer `events.club_id`.
- Decide whether recommendations and A/B testing are still product priorities
  before removing `user_recommendations`, `ab_assignments`, or
  `ab_test_events`.
- Decide whether frontend notification settings should be fully backed by
  `notification_preferences` or whether local-only settings should be removed.
- Decide whether `club_integrations` is a real integration surface; if not,
  remove the table and visible club-panel routes together.
- If club-owned QR posters become self-serve, add `qr_codes.club_id` instead of
  relying only on creator identity.
