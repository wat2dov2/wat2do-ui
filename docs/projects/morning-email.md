# Project: Morning Email (Digest Consolidation + Going Reminders + Recommendations)

Status: planned (roughly 1.5 weeks of work).
Owner: Tony.

## Brief

Replace the three existing digest flows (morning_digest, weekly_digest, daily_new_events) with one personalized morning email per user, sent at 9am in the user's school timezone.
Section 1 is "Your events today" (occurrences the user marked Going that happen today).
Section 2 is "New events picked for you" (events added since the user's last email, ranked using the existing recommender pipeline).
The event-change fanout to Going users is not a digest and stays untouched.

This project also includes the prerequisite product change that makes section 1 precise: Going becomes occurrence-aware.
For an event with multiple upcoming occurrences, the Going button opens a drawer with a multi-select of occurrences instead of toggling immediately.
That drawer is a product feature in its own right, but it lives in this project because the reminder's correctness depends on knowing which occurrence the user actually plans to attend.

### Locked decisions

1. All three existing digests are deleted, not deprecated: flows, timing helpers, notification types, preference toggles, templates, locale keys, and tests go in the same change.
   No compatibility shims.
2. One new notification type with a new name (`morning_email`), so old `notifications_log` rows from deleted types stay as inert history and can never collide with new sends.
3. Reuse the existing machinery unchanged: the hourly dispatcher (`jobs/send_notifications.py`), school-derived timezone (`resolve_user_timezone`), the high-water mark pattern (`_last_successful_send_at`), `notifications_log` idempotency, the Resend gateway with dry-run default, and `is_enabled` preference checks.
4. Send at 9am local, on the hour.
   This kills the :30-minute cron-cadence trap that daily_new_events had.
5. Default on for all users with one-click unsubscribe.
   CASL applies: existing relationship, identification, working unsubscribe.
6. Skip rules: no email if both sections are empty; send with one section if the other is empty.
   The first-ever send caps the new-events lookback at 48h.
7. Recommendations come from the precomputed `user_recommendations` table (nightly `recommender/job.py`), not from scoring at send time.
   Section 2 intersects precomputed recommendations with new-since-last-send events and fills any remainder with popularity-ranked new events.
   No new ML surface, no queues, no caching layers.
8. Going is occurrence-aware.
   Going rows link to a specific event occurrence (`event_dates` row), not just the event.
   Events with one upcoming occurrence keep the current one-tap toggle.
   Events with multiple upcoming occurrences open a drawer with a multi-select of occurrences; confirming the selection is the whole flow.
   Existing event-level Going rows are backfilled to the event's next upcoming occurrence.
   Public going counts stay aggregated at the event level.

### Success criteria

Exactly one digest concept is left in the codebase.
A user who marked Going gets their reminder at 9am local, listing only the occurrences they actually selected.
Multi-occurrence events never produce ambiguous reminders (no "which showing did I say yes to?").
New-event recommendations dedupe correctly across days.
Zero references to the deleted digests remain anywhere (code, prefs UI, locales, tests).
Domain-authenticated sends land in inboxes, not spam.

## Issues

### 1.1 Delete the three digest flows and all fallout

Remove from `services/notifications/digests.py`: `send_morning_digest`, `send_weekly_digest`, `send_daily_new_events_digest`, and their now-unused private helpers.
Remove from `services/notifications/schedule.py`: `is_morning_digest_time`, `is_weekly_digest_time`, `is_daily_new_events_time`, and their hour/weekday constants.
Remove the three `NOTIFICATION_TYPE_*` constants, the dispatcher wiring and `--only` argparse choices in the job, digest-specific rendering functions in `rendering.py`, the three preference types in `preferences.py` and the notification-preferences API surface, the frontend settings toggles and their locale keys, and all orphaned tests.
Keep: the `notifications_log` table and rows (history), `event_change.py`, `email_service.py`, the dispatcher skeleton, and timezone resolution.
Done when: a repo-wide search for the three type names and function names returns nothing; typecheck, lint, and the test suite pass; and the settings UI shows no dead toggles.
Note: land this in the same change as 2.x so the dispatcher never ships with zero send types.

### 1.2 Data-shape audit for the two sections

Short written check before building.
Confirm the current shape of Going rows (the `going_events` tables/service) and exactly what schema change 5.1 needs to link them to `event_dates` occurrences, including how the backfill to next-upcoming-occurrence handles events with no future occurrence.
Confirm which timestamp marks an event as "added" for the high-water mark (created_at vs first-seen by the scraper).
Confirm the shape of `user_recommendations` rows and what the read path (`get_recommendations`) filters at read time.
Confirm the GitHub Actions schedule for `recommender/job.py` completes before the earliest 9am-local send, and document the scrape, then recompute, then send ordering as a stated dependency.
Identify the existing drawer component used by the events feature so 5.2 reuses it rather than adding a second drawer pattern.
Done when: one page states the exact queries both sections will use, the 5.1 migration plan, and the job-ordering dependency.
Do first; this shapes everything in categories 2 and 5.

### 2.1 Going-today section

Service function: given a user and their local date, return the occurrences they marked Going that happen today, ordered by start time, with title, time, location, and event page URL.
Because Going rows are occurrence-level (5.1), this is a direct join with no guessing about which occurrence the user meant.
Reuses the existing event-fetch helpers in `digests.py` where they fit.
Done when: unit tests cover a going occurrence today, a going occurrence on another day (excluded), an unselected occurrence of the same event today (excluded), and a cancelled event (excluded, consistent with event_change behavior).
Depends: 1.2, 5.1.

### 2.2 Recommended-new-events section

Service function:
fetch events added since `_last_successful_send_at(user, morning_email)`, capped at 48h when there is no prior send;
exclude events the user already marked Going;
intersect with the user's precomputed `user_recommendations` rows;
fill any remainder with the new events ranked by the existing popularity scorer (a cheap standalone call);
cap at 6 and drop the section if empty.
Cold-start users simply get popularity-ranked new events, matching the app's own fallback.
Done when: unit tests cover an intersection hit, a thin intersection with popularity fill, a cold-start user, Going exclusion, the high-water mark advancing across sends, and the first-send 48h cap.
Depends: 1.2.

### 2.3 Template and rendering

One template in `rendering.py`: a subject line reflecting content ("2 events today + 4 new picks" style), section 1 then section 2, either section omitted when empty, HTML plus plain-text parts, an unsubscribe link, and `List-Unsubscribe` / `List-Unsubscribe-Post` headers if the Resend payload does not already set them.
Done when: rendered output is verified for all three occupancy states (both sections, only reminders, only picks) via snapshot or fixture tests, and passes a mail-tester spam check in staging.
Depends: 2.1, 2.2 shapes (can stub data).

### 2.4 Send flow and dispatcher wiring

New `send_morning_email(user, local_date)` composing 2.1 + 2.2 + 2.3 with the existing `_send_digest`-style guts: the `is_enabled` check, skip when both sections are empty, a `notifications_log` write with `target_id=local_date`, and a Resend idempotency key.
New `is_morning_email_time` (9am local, on the hour), dispatcher registration, and `--only morning-email` support.
Done when: running the job with `--now` at a matching hour sends exactly once (re-run is a no-op via the unique constraint), skips opted-out users, and logs skips with reasons.
Depends: 2.1, 2.2, 2.3, 1.1.

### 3.1 Preference toggle and settings UI

One preference: `morning_email`, default on.
Backend type registered in `preferences.py`; the frontend settings section replaces the removed toggles with this single one, locale keys included.
Done when: toggling off in the UI stops the send (verified through the dispatcher path, not just the API), and the unsubscribe link in the email flips this same preference: one concept, both directions.
Depends: 1.1.

### 3.2 Deliverability setup

Resend domain authentication for the sending domain (SPF, DKIM, DMARC), a from-address decision (e.g. `hello@wat2do.ca`), and verification that one-click unsubscribe works from Gmail's native button.
Done when: a real send to Gmail and Outlook lands in the inbox with authentication passing (check headers).
Parallel with everything; needed before 4.2.

### 4.1 End-to-end verification

Seeded fixtures: a user with Going events today, new events since yesterday, an opted-out user, and a brand-new user (48h cap).
Run the dispatcher in dry-run across a full simulated day of `--now` hours, then one real send-to-self.
Done when: every fixture case behaves per the locked decisions and the send-to-self email reads correctly on mobile.
Depends: 2.4, 3.1.

### 4.2 Production rollout

Verify the production cron runs hourly on the hour, verify the recommender job finishes before the earliest 9am-local send (from 1.2), enable the Resend key, watch `notifications_log` and skip-reason logs for the first three mornings, and confirm timezone firing looks right for the school.
Done when: three consecutive clean morning runs happen with no duplicate sends and no orphaned failures.
Depends: 4.1, 3.2.

## Category 5: Occurrence-aware Going (prerequisite, runs first despite the number)

### 5.1 Occurrence-level Going data model and API

Migration: Going rows gain a reference to their `event_dates` occurrence, unique per (user, occurrence).
Backfill existing event-level Going rows to the event's next upcoming occurrence; rows for events with no future occurrence are dropped (plan confirmed in 1.2).
API: marking Going accepts one or more occurrence ids; unmarking removes per occurrence; the single-occurrence path stays a one-call toggle so existing call sites barely change.
Going counts shown on cards stay aggregated at the event level (count distinct users), so the counts feature is unaffected.
Audit both sides of the wire contract: request params, response shape, and generated API types must agree exactly.
Done when: migration applies with backfill verified against production-shaped fixtures, API tests cover multi-occurrence mark/unmark and the one-occurrence fast path, and no event-level Going write path remains.
Depends: 1.2.

### 5.2 Occurrence picker drawer on the Going button

For events with more than one upcoming occurrence, the Going button opens a drawer (reuse the events feature's existing drawer component, identified in 1.2) listing upcoming occurrences with date and time, each with a checkbox.
Multi-select, confirm, done; that is the whole flow.
Events with exactly one upcoming occurrence keep the current instant toggle with no drawer.
The button reflects state: going to at least one occurrence renders as Going; reopening the drawer edits the selection.
Optimistic updates follow the existing going-events store pattern; i18n keys in both locales.
Done when: drawer flow works end-to-end against 5.1 in the browser (mark two of three occurrences, reminder-relevant state is queryable), the single-occurrence path is visually unchanged, and mobile layout is verified.
Depends: 5.1.

## Sequencing

1.2 first (half a day), then 5.1 and 5.2 (the Going prerequisite ships as its own user-facing change, independent of any email), then 2.1/2.2/2.3 in parallel, then 2.4 + 1.1 together as the swap commit, then 3.1.
3.2 runs anytime in parallel.
4.1 then 4.2 gate the launch.
Two ordering rules matter: deletion (1.1) and the new send type (2.4) land together so there is never a state with zero or four digest concepts, and 5.1 lands before 2.1 so the reminder query is occurrence-precise from day one.

## Related

The default recommended-events view for logged-in users (separate effort) reads the same `user_recommendations` rows, so the email's picks and the app's picks stay consistent with one source of recommendation truth.
If the recommender job cadence is increased for that view, re-verify the ordering dependency in 1.2 once.
