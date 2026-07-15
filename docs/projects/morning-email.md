# Project: Morning Email (Digest Consolidation + Going Reminders + Recommendations)

Status: planned (roughly one week of work).
Owner: Tony.

## Brief

Replace the three existing digest flows (morning_digest, weekly_digest, daily_new_events) with one personalized morning email per user, sent at 9am in the user's school timezone.
Section 1 is "Your events today" (events the user marked Going).
Section 2 is "New events picked for you" (events added since the user's last email, ranked using the existing recommender pipeline).
The event-change fanout to Going users is not a digest and stays untouched.

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

### Success criteria

Exactly one digest concept is left in the codebase.
A user who marked Going gets their reminder at 9am local.
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
Confirm how Going rows link users to events and occurrences (the `going_events` tables/service).
Confirm which timestamp marks an event as "added" for the high-water mark (created_at vs first-seen by the scraper).
Confirm the shape of `user_recommendations` rows and what the read path (`get_recommendations`) filters at read time.
Confirm the GitHub Actions schedule for `recommender/job.py` completes before the earliest 9am-local send, and document the scrape, then recompute, then send ordering as a stated dependency.
Flag anything that forces a scope decision (e.g. recurring events with multiple occurrences today).
Done when: one page states the exact queries both sections will use and the job-ordering dependency.
Do first; this shapes everything in Category 2.

### 2.1 Going-today section

Service function: given a user and their local date, return their Going events with an occurrence today, ordered by start time, with title, time, location, and event page URL.
Reuses the existing event-fetch helpers in `digests.py` where they fit.
Done when: unit tests cover a going event today, a going event on another day (excluded), a cancelled event (excluded, consistent with event_change behavior), and multiple occurrences.
Depends: 1.2.

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

## Sequencing

1.2 first (half a day), then 2.1/2.2/2.3 in parallel, then 2.4 + 1.1 together as the swap commit, then 3.1.
3.2 runs anytime in parallel.
4.1 then 4.2 gate the launch.
The only ordering rule that matters: deletion (1.1) and the new send type (2.4) land together so there is never a state with zero or four digest concepts.

## Related

The default recommended-events view for logged-in users (separate effort) reads the same `user_recommendations` rows, so the email's picks and the app's picks stay consistent with one source of recommendation truth.
If the recommender job cadence is increased for that view, re-verify the ordering dependency in 1.2 once.
