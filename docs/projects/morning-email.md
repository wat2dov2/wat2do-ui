# Project: Morning Email

Status: implemented.
Owner: Tony.

## 1. Goal

Replace `morning_digest`, `weekly_digest`, and `daily_new_events` with one recommendation-only `morning_email` sent around 9:00 AM in the user's school timezone.

The morning email contains events added in the previous 24 hours whose stored nightly recommendation score is at least `0.30`.
It also presents the average relevance of those picks as a `0-100` daily score with Grey, Bronze, Silver, Gold, or Diamond loot.

`event_reminder` is a separate email sent about one hour before an occurrence the user explicitly selected as Going.
Going is occurrence-aware so the reminder targets the showing the user intends to attend.

`event_change` remains a separate immediate notification.

## 2. Locked behavior

- Delete the three old digest types and their code, settings, locales, workflows, and tests.
- Keep old `notifications_log` rows as inert history.
- Use `morning_email` as the new type.
- Use `event_reminder` as the one-hour Going reminder type.
- Default `morning_email` to enabled.
- Default `event_reminder` to enabled.
- Send a morning email only when at least one recommendation qualifies.
- Use the user's school timezone.
- Use the selected occurrence for reminders, calendar entries, and Going state.
- Keep public Going counts at the event level using distinct users.
- Read stored `user_recommendations` at send time.
- Never run the recommendation pipeline while composing email.
- Require a stored recommendation score of at least `0.30`.
- Use a fixed 24-hour recent-event window.
- Average the sent picks' scores into one clamped `0-100` daily score.
- Resolve the daily score through validated loot-tier thresholds.
- Do not apply a separate email item cap.
- Keep one preference per active notification type, shared by settings and unsubscribe.
- Keep one canonical write path for Going selections.
- Do not add compatibility shims or parallel APIs.

## 3. Corrections found during implementation review

The original detailed plan had several designs that would not work safely in this repository.
The implementation must use the corrected rules below.

### 3.1 Do not require an exact minute match

GitHub Actions scheduled jobs can start several minutes late.
Checking `local.minute == 0` can skip the entire day's email.

The dispatcher should treat a user as due when the local hour is 9.
The unique `(user_id, notification_type, local_date, channel)` delivery key prevents a delayed or repeated run from sending twice.

GitHub Actions is an approximate scheduler.
If exact 9:00:00 delivery becomes a hard product requirement, move the job to a scheduler with an execution SLA rather than adding increasingly complex catch-up logic.

### 3.2 Use one fixed 24-hour content window

The morning email is a daily view, not a catch-up queue.
Each run uses one captured UTC time and considers only events added during the immediately preceding 24 hours.

Use:

```text
window_end = one captured now_utc value
window_start = window_end - 24 hours
```

The local-date delivery key still prevents duplicate sends.
A failed or missed day does not expand the next day's content window.

### 3.3 Failed and stale pending log rows must be retryable

The current unique delivery row permanently blocks retries after a failed send or a crash that leaves `pending` behind.

Add one atomic claim function that:

- Inserts a new pending row when none exists.
- Returns no claim for an already-sent row.
- Reclaims a failed row.
- Reclaims a pending row only after a short stale threshold.
- Increments `attempt_count` and updates `last_attempt_at`.
- Preserves the same provider idempotency key for every retry of the same user, type, and local date.

Retry provider timeouts, HTTP 429, and HTTP 5xx responses a small bounded number of times using the same key.
Do not retry permanent validation or authentication errors.

### 3.4 Occurrence updates must be transactional

The current Python snapshot rollback deletes occurrence rows and tries to recreate them later.
It cannot restore the original IDs and cannot restore Going rows already removed by `ON DELETE CASCADE`.

Replace it with a PostgreSQL transaction exposed through one RPC.
The transaction must update the parent event and its occurrences together so metadata cannot commit while occurrence updates fail.

### 3.5 Never infer occurrence identity by list position

For authenticated event edits, the frontend and backend carry explicit occurrence IDs.

For scraper updates that do not have source occurrence IDs:

- Preserve only exact occurrence-signature matches.
- Treat unmatched old occurrences as removed.
- Treat unmatched new occurrences as new.
- Do not pair leftovers by index, date proximity, or array position.

Guessing can transfer a user's Going selection to a different showing.
A new occurrence ID is safer than a false identity match.

### 3.6 Do not nest the Going picker Drawer inside event details

The shared Drawer globally releases pointer and scroll state when a drawer closes.
Closing a nested picker could disturb the still-open event-details drawer.

Use one reusable picker-content component:

- From an event card, render it inside a normal Drawer.
- Inside `EventDetailsModal`, replace the details body with the picker content.
- Back or Cancel restores the details body.

Do not rewrite the shared Drawer as part of this project.

### 3.7 Do not optimistically calculate public Going counts

Changing one selected occurrence to two selected occurrences does not add another attendee.
The current `+1` and `-1` optimistic count math becomes wrong.

Optimistically update only the current user's selection cache.
Patch the public `going_count` from the authoritative mutation response.

### 3.8 Do not compose email with per-user database reads

A naive implementation would issue preferences, Going, recommendation, and event queries for every user.
That is the main N+1 risk in this project.

All read-side email data must be loaded in batches by eligible timezone, school, and bounded ID chunks.

Per-recipient delivery-log claims and provider sends are intentional isolated side effects.
They are not accidental read-side N+1 queries.

## 4. Simplified target architecture

## 4.1 Stable occurrences and occurrence-aware Going

### Event occurrence contract

Use separate create and update occurrence schemas:

- Create occurrences never contain an ID.
- Update occurrences may contain an existing UUID.
- An existing UUID must belong to the event being updated.
- A missing UUID means a new occurrence.
- An omitted existing UUID means removal.
- `OccurrenceResponse.id` is UUID only.

The frontend must preserve the occurrence ID through:

- API response.
- Event-to-form conversion.
- Form state.
- Update payload construction.

Do not use the create payload builder for event updates.

### Transactional event update RPC

Create one `update_event_with_occurrences` database function that:

1. Locks the event row.
2. Captures distinct pre-change Going user IDs.
3. Validates the event patch and occurrence IDs already validated at the API boundary.
4. Updates retained occurrences in place.
5. Inserts new occurrences.
6. Deletes omitted occurrences.
7. Updates the parent event.
8. Returns the updated occurrence rows and captured recipient IDs.

Any failure rolls back every parent-event, occurrence, and cascading Going change.

Authenticated edits use explicit IDs.
Scraper edits pass IDs only for exact-signature matches.

### Going table

Keep `event_id` because every existing consumer needs event-level access.
Add `event_date_id` as the selected occurrence reference.

Use these constraints and indexes only:

- `UNIQUE event_dates(event_id, id)` as the composite foreign-key target.
- Composite foreign key `(event_id, event_date_id)` to `event_dates(event_id, id)`.
- `UNIQUE (user_id, event_date_id)` for selection uniqueness.
- `INDEX (event_date_id)` for occurrence cascades.
- `INDEX (event_id, user_id)` for counts and fanout.
- `INDEX (user_id, event_id)` for grouped reads and the distinct-event cap.

Do not add redundant standalone indexes whose leading column is already covered.

### Backfill

In one migration:

1. Add nullable `event_date_id`.
2. Assign each existing row to its event's next future occurrence, ordered by start time and ID.
3. Delete rows whose event has no future occurrence.
4. Assert that no surviving row has a null occurrence.
5. Replace unique `(user_id, event_id)` with unique `(user_id, event_date_id)`.
6. Add the composite constraints and minimal indexes.
7. Make `event_date_id` non-null.
8. Add the Going mutation and event-count RPCs.
9. Enable and verify RLS.
10. Revoke RPC execution from `PUBLIC`, `anon`, and `authenticated`; grant it to `service_role` only.

Do not edit historical migration files.

### One Going mutation function

Create one `set_user_going_occurrences` RPC used by both PUT and DELETE.

The function must:

1. Lock the user's row to serialize concurrent cap checks.
2. Normalize and deduplicate the supplied UUID array.
3. Validate that the event exists.
4. Validate that every occurrence belongs to the event.
5. Validate that every newly selected occurrence is selectable.
6. Count distinct selected events for the cap.
7. Allow editing an already-selected event while at the cap.
8. Replace the event's complete selected-occurrence set atomically.
9. Return selected occurrence IDs, status, and the distinct-user event count.

`DELETE /going-events/{event_id}` calls the same RPC with an empty occurrence list.
The router must not perform separate existence, count, insert, delete, and recount calls.

### Going API

`GET /going-events/` returns grouped selections:

```json
[
  {
    "event_id": 42,
    "occurrence_ids": ["uuid-1", "uuid-2"]
  }
]
```

`PUT /going-events/{event_id}` accepts the complete desired selection:

```json
{
  "occurrence_ids": ["uuid-1", "uuid-2"]
}
```

The mutation response is:

```json
{
  "status": "going",
  "event_id": 42,
  "occurrence_ids": ["uuid-1", "uuid-2"],
  "going_count": 7
}
```

Use generated OpenAPI types end to end.
Delete handwritten frontend wire types.

### Selectable and active state

An occurrence is selectable when its start is at or after the operation's captured current time and the event is not cancelled.
The backend is authoritative.

The frontend derives active state from the intersection of:

- Selected occurrence IDs returned by the Going query.
- Selectable occurrence IDs embedded in the event response.

A historical selection by itself must not make a future occurrence appear selected.

### Event counts

Add `get_event_going_counts(integer[])`, matching the existing click-count RPC pattern.
Use `COUNT(DISTINCT user_id)` grouped by event.

The event stats endpoint calls it once for a batch of event IDs.
PUT and DELETE use the count returned by the mutation RPC.
Delete the separate post-mutation count query.

### Calendar

Keep the existing batched calendar structure:

1. Fetch the user's `(event_id, event_date_id)` rows with pagination.
2. Fetch unique event rows in chunks.
3. Fetch only selected occurrence IDs through a chunked `list_by_ids` helper.
4. Group occurrences by event.
5. Reuse the existing calendar renderer.

Do not fetch every occurrence for a selected event.
Do not issue a query per event.

### Recommendation inputs and cache

Collapse multiple occurrence selections into one `(user_id, event_id)` pair before collaborative filtering.
Clear the existing Going cache after every successful selection mutation.

### Event-change fanout

Use the distinct pre-change user IDs returned by the transactional event update.
This preserves recipients whose selected occurrence was removed.

For one event change:

- Fetch recipient users in chunks.
- Fetch explicit `event_change` preferences for all recipients in chunks.
- Apply default-enabled behavior in memory.
- Pass the already-loaded event summary into fanout.
- Do not re-fetch the event.
- Do not call `is_enabled` once per recipient.

Provider sends and delivery claims remain per recipient unless measured fanout volume later requires a batch provider path.

## 4.2 Frontend Going flow

### Query ownership

Replace the Going Zustand server-state store with one user-scoped TanStack Query family:

```text
queryKeys.goingEvents.byUser(userId)
```

Requirements:

- One GET for all Going selections.
- One PUT for any non-empty complete selection.
- One DELETE to clear an event selection.
- No API request per card.
- No API request per occurrence.
- No occurrence-detail fetch because event responses already contain occurrences.
- Remove the whole Going query family on logout.
- Never reuse user A's cached selection under user B's key.
- Remove the manual Going bootstrap fetch from `app-page.tsx`.

### One behavior hook

Use one events-feature hook for card and details triggers.
It owns:

- Selectable-occurrence derivation.
- Active state.
- Single-occurrence PUT or DELETE decision.
- Opening multi-occurrence selection.
- Per-event pending state.
- Selection-cache optimism and rollback.
- Authoritative stats patching.
- Tracking.
- Localized errors.

Keep card and details buttons as separate presentation components.
Do not create a universal button abstraction.

### Picker content

Create one presentation-first picker-content component:

- Chronological selectable occurrences.
- Local date and time.
- Accessible checkboxes.
- A local draft initialized from selected selectable IDs.
- Confirm, Cancel, loading, and error states.
- Confirm disabled during mutation.
- Draft preserved after a failed save.

Use it in:

- A Drawer opened from an event card.
- An inline replacement view inside the existing details Drawer.

### Single-occurrence behavior

- One selectable occurrence and not selected: PUT that ID.
- One selectable occurrence and selected: DELETE the event selection.
- Multiple selectable occurrences: open the picker.
- No selectable occurrences: disable the action.

Disable the event's Going action while its mutation is pending so requests cannot arrive out of order.

### Public count behavior

Optimistically update only the selection query.
Do not predict `going_count`.
Patch `going_count` from the mutation response.

### Notification settings

Keep `useNotifications`, but make it one user-scoped TanStack query and one mutation.

- One GET loads all active preferences.
- Render loading or disabled controls until preferences resolve.
- Show a retryable error instead of misleading default-on switches after a load failure.
- Optimistically patch one changed preference and roll back on failure.
- One PATCH occurs only when the user changes a toggle.

The settings UI contains:

- Morning email.
- Event reminders.
- Event-change alerts.

Delete the generic email, new-event, daily digest, and weekly digest settings.

### Onboarding cleanup

Delete the daily-new-events opt-in step and all related state, API helpers, imports, copy, and tests.
Reduce onboarding from six steps to five.

## 4.3 Batched morning-email composition

### Dispatcher eligibility

1. Fetch all users with email and school using the existing pagination utilities.
2. Resolve timezone in memory.
3. Keep users whose local hour is 9.
4. Group eligible users by timezone and school.

The user loader must not silently stop at PostgREST's 1,000-row limit.

Users with a missing school receive no cross-school recommendations.

### Batch loaders

For all eligible users, load:

- Explicit `morning_email` preference rows in user-ID chunks.
- Stored recommendation rows by user-ID chunk.

For each eligible school, load once:

- Non-cancelled events added within the fixed 24-hour window.
- The earliest future occurrence for each candidate event.

After candidate IDs are known, load once per chunk:

- Going exclusions only for those candidate event IDs and eligible users.

Build each user's recommendation list in memory from these maps.

### Query-count invariant

Database read count must scale with:

```text
user ID chunks + eligible timezones + eligible schools + candidate ID chunks
```

It must not scale as:

```text
eligible users x query families
```

Add a service test that composes one user and many same-school users and proves query calls grow only when a configured chunk boundary is crossed.

### New-event candidates

Capture one `window_end` at the start of the dispatcher tick and derive:

```text
window_start = window_end - 24 hours
```

For each school, fetch candidate events once from that fixed start.

Candidate requirements:

- Same school as the user.
- `added_at > window_start`.
- `added_at <= window_end`.
- Not cancelled.
- At least one occurrence starts at or after `window_end`.
- Hydrated with the earliest future occurrence.
- Excluded when the user has any Going selection for that event.

### Recommendation ranking

Use one batch read helper owned by the recommender service that returns stored rows only.
It must never fall back to live computation.

For each user:

1. Keep stored recommendation rows whose score is at least `0.30`.
2. Intersect those rows with the user's candidate IDs.
3. Preserve stored nightly rank order.
4. Return every match without a separate email cap.

The stored nightly snapshot currently has a natural upper bound of 20 rows per user.
If stored recommendations are absent or stale, no morning email is sent.
Event reminders remain independent of the recommendation snapshot.

### Daily score and loot tier

For each prepared morning email:

1. Average the stored predicted scores of the qualifying picks.
2. Multiply by 100, round to an integer, and clamp to `0-100`.
3. Resolve the score through the validated thresholds in `morning_email.json`.
4. Render the score and tier in HTML and plain text.

Email colors use semantic roles matching the application's dark design tokens.
Decorative loot colors stay separate from functional surface, text, and border colors.

### Sending

For each prepared non-empty email:

1. Claim its delivery row immediately before provider submission.
2. Skip when the claim reports already sent.
3. Render from the already-prepared view model.
4. Send with the stable per-recipient idempotency key.
5. Mark sent with `sent_at`.
6. Mark failed with an operator-safe error category after bounded retries fail.

Keep individual provider sends initially because they preserve per-recipient isolation and stable idempotency.
Do not add Resend batch sending unless measured runtime approaches the workflow timeout.

## 4.4 Morning-email rendering

### Subject

- `4 new picks for you`
- Use correct singular forms.

### Body requirements

- HTML and plain text.
- Display the daily score and loot tier before recommendations.
- Display local occurrence time.
- Link events to `/?eventId={id}`.
- Escape every event-controlled HTML value.
- Include a visible manage-preferences link.
- Include a visible unsubscribe link.
- Include sender identification required for production email.
- Use `FRONTEND_URL` from the job environment so links never fall back to localhost.

Keep rendering functions in the existing notification rendering module.
Create one morning-email orchestration module and delete the old digest module when no caller remains.

## 4.5 Preferences and unsubscribe

Keep only these active types:

- `morning_email`
- `event_reminder`
- `event_change`

Delete stale preference rows for old types in a new migration.
Do not delete historical log rows and do not edit old migrations.

Use a stateless signed unsubscribe token instead of storing another user token column.

The token contains only:

- User UUID.
- Notification type.
- Token version.
- HMAC signature using a dedicated `EMAIL_UNSUBSCRIBE_SECRET`.

Requirements:

- Standard-library HMAC and URL-safe encoding.
- Constant-time signature verification.
- No expiry, so old email unsubscribe links keep working.
- No email address or profile data in the token.
- A future token-version change can invalidate the format deliberately.

Endpoints:

- GET displays a confirmation page and does not mutate state.
- POST verifies the token and disables the notification type carried by the token idempotently.
- Invalid tokens return a generic response without exposing account existence.

Add provider headers:

```text
List-Unsubscribe: <https://wat2do.app/api/notification-preferences/unsubscribe?token=...>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

Extend `EmailMessage` with custom headers and pass them through the Resend payload.

## 4.6 Workflow ordering

Use one scheduled-email workflow with separate triggers for morning email and event reminders.

Use:

```yaml
schedule:
  - cron: "0 * * * *"
  - cron: "2-57/5 * * * *"
```

The backend checks local hour, not exact minute.
The reminder dispatcher uses an overlapping window around one hour before start.
The occurrence-and-start delivery key prevents duplicate sends across overlapping ticks.
Keep manual `now` input for deterministic testing.
Set `FRONTEND_URL`, email provider variables, and the unsubscribe secret explicitly.

Keep the daily scrape schedule.
Trigger recommendation computation after a successful scrape workflow completion.
Retain manual recommendation dispatch.

Email must degrade safely when recommendations are stale:

- Event reminders still render.
- The morning email may be thin or omitted.
- Freshness is logged and monitored.

Do not make reminder delivery depend on a successful recommendation run.

## 5. N+1 budget

The following invariants are release requirements.

### Going UI

- One Going GET per authenticated user query key.
- One stats GET per school.
- Zero requests per event card.
- Zero requests per occurrence.
- One PUT for any non-empty selection.
- One DELETE for an empty selection.

### Going backend

- One RPC per selection mutation.
- One aggregate count RPC per event-stats batch.
- Calendar queries scale by ID chunks, not events.
- Event-change users and preferences load by chunks, not recipients.

### Morning email

- Users load with pagination.
- Preferences load by chunks.
- Candidate events load by school.
- Recommendation rows load by user chunks.
- Going exclusions load only for candidate events.
- No database read is issued from the per-user composition loop.

### Event reminders

- Due Going selections load by occurrence window.
- Users and preferences load by ID chunks.
- Cancelled events are excluded.
- Delivery deduplicates by user, occurrence, and scheduled start.
- No database read is issued from the per-reminder delivery loop.

### Intentional per-recipient work

- Delivery claim.
- Provider submission.
- Final delivery status update.

These writes and external side effects remain isolated for idempotency and failure handling.

## 6. Implementation sequence

## Phase 1: Baseline and data audit

- Run current backend and frontend checks.
- Count existing Going rows.
- Count rows with no future occurrence.
- Measure multi-occurrence events.
- Inspect recommendation freshness and row volume.
- Measure active user count per school.
- Confirm production frontend URL and sending domain.
- Record existing unrelated failures.

Gate: migration assumptions use real production-shaped counts.

## Phase 2: Transactional occurrence updates

- Add explicit update occurrence IDs across backend schemas and frontend edit form data.
- Split create and update payload builders.
- Add transactional parent-event and occurrence RPC.
- Change scraper matching to exact signatures only.
- Return pre-change Going recipients.
- Delete Python snapshot replacement.

Gate: a forced failure rolls back event metadata, occurrences, and Going cascades together.

## Phase 3: Occurrence-aware Going

- Apply the backfill, constraints, indexes, and RPC migration.
- Replace router orchestration with the single selection RPC.
- Add grouped reads using pagination.
- Add aggregate distinct-user counts.
- Invalidate and deduplicate collaborative Going data.
- Update selected-occurrence calendar hydration.
- Batch event-change users and preferences.
- Finalize Pydantic and generated OpenAPI contracts.

Gate: no surviving Going row lacks a valid selected occurrence.

## Phase 4: Going frontend

- Add the user-scoped Going query and mutations.
- Delete the Going Zustand store and manual bootstrap fetch.
- Add the shared behavior hook.
- Add picker content, card Drawer wrapper, and inline details view.
- Use selection-only optimism and authoritative counts.
- Update filters, cards, details, stats, auth cleanup, locales, and mocks.

Gate: selecting two of three occurrences produces one PUT and one distinct attendee.

## Phase 5: Batched morning-email composition

- Add the retry-claim migration.
- Add the batch preference loader.
- Add batch candidate-event, recommendation, and exclusion loaders.
- Add precomputed-only recommendation reads.
- Build per-user recommendation lists in memory.
- Add the morning-email send flow and rendering.
- Add stateless unsubscribe and custom email headers.

Gate: database read-call count does not grow per eligible user.

## Phase 6: Delete old digests and update settings

- Replace notification constants and schema literals.
- Delete old timing helpers, rendering functions, dispatcher branches, preferences, locales, onboarding state, tests, and workflow.
- Add morning-email, event-reminder, and event-change settings backed by a user-scoped query.
- Regenerate API types once contracts are final.
- Search the executable repository for deleted names.

Gate: only `morning_email`, `event_reminder`, and `event_change` remain active.

## Phase 7: Workflow, staging, and deliverability

- Add the hourly morning trigger, five-minute reminder trigger, and scrape-to-recommendation trigger.
- Run a simulated 24-hour dispatcher day.
- Verify daylight-saving boundaries.
- Send real Gmail and Outlook messages.
- Verify SPF, DKIM, DMARC, plain text, mobile layout, and native unsubscribe.
- Verify retry behavior with simulated timeout, 429, 5xx, failed, and stale-pending cases.

Gate: staging sends once per local date and links never point to localhost.

## Phase 8: Production rollout

Use a short announced Going-write maintenance window rather than compatibility code:

1. Deploy transactional occurrence-update support.
2. Pause Going mutations.
3. Apply the occurrence-aware Going migration and RPCs.
4. Deploy the backend and frontend contract release.
5. Run Going, count, calendar, and event-change smoke tests.
6. Re-enable Going mutations.
7. Deploy scheduled-email code and workflow replacement.
8. Run dry-run and send-to-self checks.
9. Enable production sending.
10. Monitor three consecutive mornings.

Do not deploy a nullable compatibility period or dual Going API.

## 7. Focused verification matrix

### Transaction and migration

- Backfill selects the next future occurrence deterministically.
- Rows without future occurrences are removed.
- Retained explicit-ID edits preserve occurrence IDs.
- Exact scraper matches preserve IDs.
- Unmatched scraper dates do not inherit attendee selections.
- Transaction failure rolls back every related change.
- Concurrent Going mutations cannot exceed the distinct-event cap.
- Cross-event occurrence IDs are rejected.

### Going behavior

- Single occurrence toggles immediately.
- Multiple occurrences use one complete-selection PUT.
- Empty selection uses DELETE.
- Changing one selected occurrence to two does not increase distinct-user count.
- Past-only selection does not activate a future occurrence.
- Cancelled and zero-selectable events cannot be newly selected.
- Rapid repeated confirmation cannot create out-of-order state.
- User A cache data never appears for user B.
- Calendar emits only selected occurrence IDs.
- Collaborative input contains one pair per user and event.

### Email content

- Today occurrence included.
- Other-day and unselected same-event occurrences excluded.
- Cancelled events excluded.
- New candidates use exact fixed 24-hour boundaries.
- Going events excluded from picks.
- Stored intersection preserves rank.
- Scores below `0.30` are excluded.
- Every qualifying stored match is included.
- Missing stored recommendations produce no recommendation section.
- Both-empty skips.
- Each one-section and two-section rendering state works.
- HTML fields are escaped.
- Local times and event links are correct.

### Delivery

- Delayed start within the local 9:00 hour still sends.
- Repeated run is deduplicated.
- Failed and stale-pending rows can be reclaimed.
- Provider retries reuse the same idempotency key.
- Opt-out blocks dispatcher delivery.
- Settings and unsubscribe change the same preference.
- Visible and native unsubscribe paths work.

### Query-count tests

- Many cards do not create additional Going GETs.
- Multi-select does not create per-occurrence requests.
- Event stats use one aggregate count RPC.
- Event-change preferences do not query per recipient.
- Morning-email reads grow by chunks and groups, not eligible-user count.

## 8. Expected file impact

### Backend and database

- `backend/core/constants/notifications.py`
- `backend/core/constants/__init__.py`
- `backend/core/config.py`
- `backend/schemas/event_date.py`
- `backend/schemas/event.py`
- `backend/schemas/going_event.py`
- `backend/schemas/notification_preference.py`
- `backend/routers/events.py`
- `backend/routers/going_events.py`
- `backend/routers/notification_preferences.py`
- `backend/services/event_date_service.py`
- `backend/services/event_service.py`
- `backend/services/going_event_service.py`
- `backend/services/calendar_service.py`
- `backend/services/email_service.py`
- `backend/services/notifications/delivery_log.py`
- `backend/services/notifications/digests.py`, deleted
- `backend/services/notifications/event_change.py`
- `backend/services/notifications/preferences.py`
- `backend/services/notifications/rendering.py`
- `backend/services/notifications/schedule.py`
- `backend/jobs/send_notifications.py`
- `backend/recommender/service.py`
- `backend/recommender/collaborative.py`
- `backend/services/scraper/event_writer.py`
- New forward-only Supabase migrations and related tests

### Frontend

- `frontend/src/shared/types/event.types.ts`
- `frontend/src/shared/utils/event.ts`
- `frontend/src/shared/api/eventPayload.ts`
- `frontend/src/shared/lib/queryKeys.ts`
- `frontend/src/shared/generated/*`, regenerated only
- `frontend/src/app/app-page.tsx`
- `frontend/src/app/client-providers.tsx`
- `frontend/src/features/events/api/events.api.ts`
- `frontend/src/features/events/components/EventCard.tsx`
- `frontend/src/features/events/components/EventDetailsModal.tsx`
- `frontend/src/features/events/hooks/useEventStats.ts`
- `frontend/src/features/events/hooks/useEventsPageData.ts`
- `frontend/src/features/events/store/goingEvents.store.ts`, deleted
- New events-feature Going hook and picker content
- Search Going consumers
- Settings API, hook, component, and locales
- Onboarding page, hook, locales, and tests
- Focused Going and notification-settings Playwright tests
- Existing Playwright fixtures that mock `/going-events`

### Workflows and configuration

- Delete `.github/workflows/daily-new-events-email.yml`.
- Add one scheduled-email workflow for hourly morning checks and five-minute reminder checks.
- Update `.github/workflows/nightly-recs.yml` to follow successful scrape completion.
- Add production `EMAIL_UNSUBSCRIBE_SECRET` and explicit `FRONTEND_URL`.
- Configure and verify the Resend sending domain.

## 9. Required checks

```bash
cd backend
.venv/bin/ruff format --check .
.venv/bin/ruff check .
.venv/bin/mypy .
.venv/bin/pytest -q
```

```bash
cd frontend
npm run generate-types
npm run lint
npm run audit:i18n
npm run type-check
npm run build
npx playwright test
```

Also run:

- Fresh local Supabase reset and migration.
- Production-shaped migration rehearsal.
- Repository-wide deleted-name search.
- Query-count tests.
- 24-hour simulated dispatcher run.
- Real staging sends to Gmail and Outlook.
- Mail authentication and unsubscribe verification.

## 10. Definition of complete

- `morning_email`, `event_reminder`, and `event_change` are the only active notification types.
- Every Going row references a valid occurrence.
- Event and occurrence updates are transactional.
- No inferred scraper identity can transfer a selection incorrectly.
- Going writes use one atomic RPC.
- Counts use distinct users in PostgreSQL.
- Calendar emits only selected occurrences.
- Event-change recipients survive occurrence removal.
- Frontend Going state is user-scoped and has no duplicate server-state store.
- Cards and occurrences do not create N+1 requests.
- Morning-email reads are batched and bounded.
- Morning-email candidates use one fixed previous-24-hour window.
- Morning email contains recommendations only.
- Daily recommendation scores and loot tiers resolve from validated controls.
- Event reminders target selected occurrences about one hour before start.
- Reminder delivery is idempotent per user, occurrence, and scheduled start.
- Failed and stale claims can retry safely.
- No email is sent twice for one user and local date.
- Settings and unsubscribe control the same preference.
- No production email link uses localhost.
- SPF, DKIM, and DMARC pass.
- Gmail and Outlook delivery is verified.
- Three consecutive production mornings finish without duplicates or unexplained failures.
