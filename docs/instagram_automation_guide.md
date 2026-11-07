# Instagram Automation Commands

The active collection path uses Instagram notifications on a physical Android phone running Automate.
Automate triggers the GitHub `process-notification` workflow, which records each exact post URL in the notification ledger.
When Instagram collapses several posts into one digest, the GitHub processing job submits a high-priority job to the Mac's shared browser worker before recording notification media.
A database trigger adds each recorded post to `public.ingestion_items`, the ingestion queue.
An always-on launchd processor on the Mac, `wat2do-ingest process` (Rust, `rust/src/ingestion`), wakes on a Postgres notification from the queue, reads each new post logged out (no account, cookie or session ID), and then runs a Claude Haiku agent through `claude -p`, which follows `backend/services/ingestion/prompt.md` and writes events and positions itself through a database login scoped to those tables.
The Brave worker likes and natively reposts the original event posts selected in newly published Instagram carousels.
Digest expansion, manual profile listing, and engagement share two worker-owned tabs in one registered Brave window, with credentials remaining inside the browser.
Brave never opens individual posts for ingestion.

## Repair an existing poster or scraped video

New scraped videos are copied to owned S3 storage and played on event and position detail views, with their images retained as posters.
Previously processed posts remain deduplicated during ordinary scraping, so deploying video support does not redownload historical posts or rerun AI extraction.
Use the targeted media repair command for an existing event or position.
It uses the same S3 storage, limits, and rendition rules as new uploads.
Configure the intended database, the `STORAGE_*` media settings (endpoint, keys, bucket and public base URL), and discovery revalidation settings in the command's environment before applying a repair.

```sh
cd backend
python scripts/repair_stored_media.py image --event-id 29122
python scripts/repair_stored_media.py instagram-image --event-id 29122 --fetch
python scripts/repair_stored_media.py video --event-id 29122
```

All repair commands default to a preview and require exactly one `--event-id` or `--position-id`.
An image preview reads the owned asset and reports its dimensions and proposed rendition size without uploading or updating the database.
A missing Instagram poster or video preview without provider data reports the exact original post that must be retrieved.
Supply `--post-json /path/to/post.json` to reuse one exact-post provider object, or add `--fetch` to explicitly retrieve only that original post through the configured Apify adapter.
The provider lookup can incur its normal charge; the command never starts a broad scrape or AI extraction.

```sh
python scripts/repair_stored_media.py video --event-id 29122 --fetch
python scripts/repair_stored_media.py video --event-id 29122 --post-json /path/to/post.json --apply
python scripts/repair_stored_media.py image --position-id 123 --apply
```

Review the preview before adding `--apply`.
Missing Instagram poster repairs use the verified original post’s cover artwork and preserve any poster already saved on the event or position.
Downloaded event artwork is resized to the shared rendition width before the stored-image size limit is checked, so a large original does not silently lose its poster.
Video repairs verify the exact source post, skip an existing stored video, and refuse carousels whose original slide association cannot be proven.
Reports omit signed provider CDN query strings.
Image repairs write a new immutable URL instead of replacing a cached file in place.
Each update is conditional on the selected row retaining the original media reference, and successful updates refresh that school's discovery data.
Existing assets remain available to other references and cached pages.

## Android notification phone

Notifications come from one physical Android phone, not an emulator.
Log the phone's Instagram app into the school accounts being collected, keeping each device to three accounts or fewer and adding devices for more capacity.
Automate's Android `NotificationListenerService` flow observes each Instagram notification and sends a `new_instagram_post` repository dispatch to GitHub.
The dispatch carries the notification's recipient ID, push ID, push category, and Instagram action.
A collapsed `subscription_daily_digest` notification is forwarded unchanged so the workflow's Rust job (`wat2do-browser process-notification`, `rust/src/instagram_notifications/process_notification.rs`) remains the single owner of media materialization.

## Shared Brave browser worker

Keep Brave running with the school accounts logged in and available under More > Switch accounts.
Open one Instagram tab for the worker to use as its primary tab.
The first registered Instagram tab is reserved for account switching and serialized likes/reposts.
Digest queries and manual profile listings use the second tab only.
After a logout, the worker logs back in by clicking a saved wat2do profile on Instagram's logged-out page (at most once every `login_recovery_interval_seconds`, `login_recovery_daily_limit` times a day; an attempt that only timed out in Brave does not count). A password prompt is answered with the account's Keychain password (`login_keychain_service`) and an emailed security code from `login_code_email`; a refused password or other challenge waits for a person. A school account missing from the switcher is logged in from the `login_from_school` account through Switch accounts, "Log into an Existing Account", at most once a day per account and `account_login_daily_limit` a day in all.
The healthy worker maintains `parallel_tabs` Instagram tabs in that same window (two by default), including when the queue is empty.
It checks pool health on startup, before batches, and every `tab_health_interval_seconds` while idle.
It persists their exact tab IDs and recreates closed worker tabs inside their registered existing window, even if every worker tab was closed.
It adopts existing Instagram tabs from that registered window up to the configured total and closes surplus Instagram tabs under the human-authorized resize policy.
Tabs in other windows or moved to another site are preserved.
A closed primary is recreated at the beginning of the registered window rather than silently promoting a retrieval tab.
Viewport preparation first checks the exact tab in the background and leaves tab selection and window bounds untouched when its renderer is ready.
Cold or repaired tabs may initialize only while Brave and their registered window are already foreground, restoring the previous tab selection afterward without activating another app or window.
When foreground initialization is required, pending jobs remain queued during the maintenance pause; bring that window forward briefly, resume the worker, and explicitly retry any failed job after inspecting it.
Primary account and engagement preparation verifies the desktop layout before reading controls and widens only an already foreground registered window to `primary_minimum_viewport_width` when needed, including the difference between outer window bounds and the page viewport.
Logged-in identity comes from the visible Profile navigation control, including compact navigation, rather than a viewed organizer's avatar or its position on the screen.
Each viewport activation, single sample, and restoration is bounded by `viewport_warm_timeout_seconds`; page waits release the shared transport.
This initialization does not run on every steady-state retrieval.
Disabled action controls receive bounded readiness polling before a single guarded click, and completion polling tolerates temporary disabled states without toggling the action again.
Surplus closure first attempts request settlement; if cancellation cannot be confirmed, the worker closes that exact surplus document and verifies its tab ID is absent before continuing.
This closure never applies to a retained primary tab or substitutes for cancellation before account switching.
Pool maintenance never clears a recovery pause.
It pins that tab for each operation and fails if the tab closes or changes to another site.
It never launches Brave, creates a separate browser profile, or logs into an account.
An authorized human completes login, two-factor prompts, and security challenges.
In Brave, enable View > Developer > Allow JavaScript from Apple Events.
This permission lets the worker switch accounts, verify the active username and recipient, resolve notification digests, and operate visible post controls in the authenticated tab.
The installed worker also needs macOS Automation permission to control Brave Browser.
Its LaunchAgent runs the installed copy `~/.local/libexec/wat2do/wat2do-browser`, so macOS asks about `wat2do-browser`: approve the prompt on its first browser job, or enable its Brave Browser entry under System Settings > Privacy & Security > Automation, then resume the worker.
Until then the worker pauses with a message that says exactly this.
`install` replaces that copy only when the worker's own sources changed (`rust/browser-worker-sources.txt`), and each replaced copy needs this approval once; rebuilding the checkout for anything else keeps the approval.
`install` refuses a binary built from uncommitted sources or outside `~/wat2do-runtime`, and puts the previous binary back if the LaunchAgent could not be replaced.
The daily notification retry (`install-retry-schedule`, after `install`) runs the same copy, never replaces it, and shares that permission.
If the prompt times out, the worker pauses before further jobs; after granting permission, inspect the failed job, resume the worker, and explicitly retry that job.
Browser cookie values, including `sessionid` and CSRF values, never leave the browser.

The worker waits for account controls to load and retries once from the intended account’s public profile when page readiness or an account switch gets stuck.
If recovery fails, a notification fails before its media ledger entry is created and can be rerun.
Saved chooser labels may remain stale after an Instagram account rename.
`school_switcher_username_overrides` contains only those observed chooser labels; the current username and recipient must still match exactly after switching.
Every engagement action verifies both the intended account and post before clicking, then checks the resulting action state.
An already liked or reposted post is left in that state.
Native reposting requires an explicit readable active/inactive state on Instagram's own control.
If that control is absent or lacks a readable state, the job reports `unsupported` without clicking it or substituting a Story share.
Other ambiguous controls fail without an engagement click.

`backend/controlbox/instagram_browser.json` owns the browser deadlines, queue polling, source polling, action pacing, and enabled actions.
The persistent queue lives under `$XDG_STATE_HOME/wat2do/instagram-browser`, or `~/.local/state/wat2do/instagram-browser` when `XDG_STATE_HOME` is unset.
All notification callers and the worker must run as the same macOS user with the same state-directory configuration.
The CLI's global `--state-directory` option supports isolated diagnostics; changing it on the worker alone does not redirect notification clients to that queue.
The queue stores public identities, post URLs, actions, sanitized results, and scheduling state.
Do not delete its database to clear an error: that also removes deduplication history and the activation watermark.

The notification workflow runs the Rust binary `wat2do-browser`, built from the run's own checkout by `scripts/notification-binary.sh`.
The binary records the source it was built from: the committed files listed in `rust/browser-worker-sources.txt`, tests excluded.
Each runner keeps copies in its tool cache (`$RUNNER_TOOL_CACHE/wat2do-notification-<os>-<arch>/bin/<fingerprint>`), outside the disposable checkout; the Mac keeps the `binaries_to_keep` most recently used, so reruns of older commits reuse theirs, and Ubuntu runners restore theirs from the Actions cache by the same fingerprint.
The binary is built before the job reads any credential, and its third-party actions are pinned by commit.
When the source changed, the job builds it again (`cargo build --release --locked`, incremental in the runner's `rust-target` directory on the Mac) before processing anything.
A missing `cargo`, a failed build, too little free disk or a binary that still does not match the checkout fails the job loudly, before any media is recorded, so the notification can be rerun.
`backend/controlbox/notification_workflow.json` owns the disk reserve, the build cache's size cap (above it the cache is cleared and rebuilt), the build's parallelism and the build and processing deadlines.
The job reads `DATABASE_URL` from the Mac's `~/wat2do-data/config/backend.env` and masks it before use.

SQLite contention and temporary storage failures use the bounded storage controls in `instagram_browser.json`.
Optional diagnostic publication cannot invalidate a committed queue transition.
Storage recovery must preserve authentication holds, operator pauses, and uncertainty about engagement clicks.
The worker's operational log rotates within `worker_log_max_bytes` and `worker_log_backup_count`, including when it is supervised by launchd.
If log storage fails, one sanitized warning identifies the continuous failure episode without repeatedly dumping tracebacks into launchd's stderr log.
Keep scheduled tasks on the installed revision; never fast-forward or replace the live worker checkout during draft generation.
Code and runtime updates belong to maintenance with the existing installation and capture locks, an owned admission pause, no running jobs, and worker health readback.

Digest callers wait through the installer's temporary pause within their original deadline, including while its service restarts.
Other recovery and operator holds still return immediately for inspection.
The resume command preserves an active installation hold or a safety reason written after the operator's status read.

### Queue priority and school ordering

The worker checks the high-priority digest queue before every browser action.
A digest arriving during retrieval stops new retrieval claims and waits for active requests to settle.
The worker then prioritizes digests before resuming retrieval.
Public post/profile jobs run concurrently on the registered secondary tabs, leaving the primary tab reserved.
One independent worker heartbeat stays fresh throughout startup, pool maintenance, preparation, and continuous retrieval streams.
Digest jobs can run concurrently only for the same recipient and account; account switches and engagement remain serialized.
All pool tabs settle their pending requests before the primary tab switches accounts, and secondary tabs reload to verify the resulting identity before a digest query.
Manual profile listing comes after digests and before engagement.
No account switch or click is interrupted halfway through to start another job.
An exclusive browser lock covers each complete operation, and a separate worker lock prevents duplicate workers.
Every completion is conditional on the original running claim's attempt and start time.
Late successes, failures, and retry callbacks cannot overwrite a newer claim or release its admission holds.
Digest submissions return their receipt in the same transaction that admits the job.
Duplicate waiters share the original pending submission's expiry rather than extending its lifetime; completed results can still be reused.
An expired caller can cancel only its original pending submission, preserving a newer retry of the same digest.
The source collector runs separately so a slow database read does not hold up ready digest jobs.
Notification collection, publishing collection, and diagnostic publication fail independently, so one source failure cannot suppress the other queues.
Apple Event transport is serialized within each call deadline while asynchronous page requests remain parallel.
Native event execution has a separate short timeout, so a stalled command cannot consume every waiting tab's transport budget.
Native navigation is spaced through its own gate, which waits outside the transport lock so other tabs can read and settle.
Queries prove their terminal result and settled request state in one atomic browser read before returning; successful operations do not repeat cancellation through the busy transport.
Each query declares whether it only reads.
When the primary tab cannot confirm cancellation of its own read-only query (a digest or a post lookup), the worker abandons that request instead of pausing for a person, because a read cannot change anything and its late result lands in its own request object.
Beyond that, a digest or retrieval job never pauses the worker over an unconfirmed cancellation, wherever in the job it happens; the job fails and retries instead.
Uncertain sends, likes and reposts still pause the worker, as do logouts that need a person.
Only idempotent reads, inventory, and cleanup retry within `bridge_retry_limit`; uncertain engagement clicks are never replayed.
Navigation uses the pinned tab's native URL setter, so blank or unresponsive page JavaScript cannot block the navigation needed to recover it.
Retrieval tabs open their actual post/profile targets before readiness checks; digest preparation uses the verified account's public profile instead of relying on a blank home feed.
Each retrieval reloads only its assigned target and verifies the batch account before publishing its result, so an unavailable first target cannot block unrelated slots.
Retrieval failures expose only fixed reason labels and valid HTTP status codes in diagnostics; response bodies and exception text stay inside the browser.
Primary initialization recovers a blank normal page through the existing public-profile bootstrap before checking the logged-in navigation identity.
Login, suspension, and challenge routes retain their recovery hold; loading documents wait within the same readiness deadline.
An unresponsive secondary read tab may be retired only by closing its exact registered document and verifying absence.
A failed secondary cleanup stops new claims and defers settlement to the batch coordinator after all active futures drain.
The coordinator confirms settlement or closes and verifies absence of that exact secondary document before repairing the slot and retrying within its read budget.
Confirmed authentication recovery errors retain their pause even if cleanup also fails.
Secondary cleanup uses `secondary_cleanup_timeout_seconds`, so one frozen read tab cannot hold every healthy slot for the primary cleanup deadline.
Primary engagement and account-switch uncertainty still require verified recovery.
Startup preserves an inspection pause for any interrupted real engagement; an interrupted read-only inspection does not create action uncertainty.
Fresh public-data refreshes receive a fresh retry budget, and safe automatic retries are requeued atomically without exposing a terminal failure to waiting callers.

Engagement work is grouped by school.
The worker stays with the selected school while it has eligible queued posts, then selects the oldest waiting post from another school.
One engagement job owns one school/account/post and performs the configured like and repost actions after a single navigation.
Notification digests take priority between posts.
Retrieval yields after an eligible engagement reaches `engagement_max_wait_seconds`, allowing likes/reposts to progress even with a continuous retrieval backlog.
Active requests settle before any account switch or engagement begins; no action is interrupted halfway through.
Failed or unsupported engagement jobs remain visible for operator inspection and are not automatically retried.
An uncertain native click or unverified completion also pauses further browser admission for inspection.
Conflicting repost states and action toolbars that borrow another post's permalink fail before clicking.
The durable queue’s `excluded_accounts` setting holds jobs for explicitly excluded school accounts across all job types without deleting or consuming them.
Profile listings respect the same exclusions.

### Notification posts and the ingestion queue

The notification workflow records exact post URLs in the production notification ledger.
A database trigger adds each post to `public.ingestion_items` with status `fetch`, keyed by its `https://www.instagram.com/p/<shortcode>/` URL, and marks the ledger row succeeded; the ledger is the notification's receipt.
A trigger on the queue sends a Postgres notification for every new or changed row, and the Mac's processor listens for them (`LISTEN ingestion_items`); it catches up on everything waiting whenever it starts or reconnects.
Its fetch lanes (`fetch_lanes` in `backend/controlbox/ingestion.json`) read each post's public page logged out with a browser-like TLS fingerprint and no cookies, then write the caption, owner, post time, coauthors, tagged users and media links onto the row and mark it `ready`.
A page with no post is read once more and then marked `gone`, which is how deleted posts are ignored.
A login wall, HTTP 429 or server error pauses every fetch lane for `fetch_block_pause_seconds`; the row waits as long, and the try counts toward its attempts, since a login wall can also be one post's own.
Ready rows go to the Haiku agents; each row ends `done` or `not_event` and stays, so a post is never processed twice.
When Claude's usage limit turns an agent away (HTTP 429), or `agent_failure_streak` agent runs fail in a row, the row goes back without spending an attempt and every agent waits until the reset Claude names, or for `agent_pause_seconds`.

Queue a post by hand:

```sh
cd backend
cargo run --release --manifest-path ../rust/Cargo.toml --bin wat2do-ingest -- enqueue --school utsc --url https://www.instagram.com/p/SHORTCODE/
cargo run --release --manifest-path ../rust/Cargo.toml --bin wat2do-ingest -- status
```

`wat2do-browser retrieve --school <slug> --url <url>` accepts the same post URLs, and also a profile.
A profile needs the login to list, so the Brave worker lists at most `profile_post_limit` recent posts on its second tab and adds each one to the ingestion queue.
Use actual club handles rather than an illustrative profile URL.
`wat2do-browser retry --job-id <id>` lists an idle profile again.
Public profile listing reuses the currently logged-in account without switching to the school's account; digest expansion and engagement still require the exact intended school account.
A login, challenge or suspended-account page pauses browser work for human recovery.
Reload worker code only when its current job has finished, preserving the spool and pause state.

### Eligible event posts

The collector reads the existing publishing batches, selected publish items, and each event's original `source_url` from the database.
Only fully published carousels qualify.
Draft selections, removed draft slides, unpublished batches, and non-Instagram source URLs do not enter the engagement queue.
It resolves the school's enabled publishing account and notification `recipient_id` from existing records, selecting public identity fields only and never loading or decrypting publishing tokens.
Missing or mismatched account configuration is skipped and checked again on a later poll.

The first collection saves its activation time locally.
Only carousels published at or after that time are eligible, so installation does not engage a historical backlog.
Activation is registered in the database once and restored if the local queue is recreated.
Later polls select only batches not delivered to the current queue generation, in deterministic timestamp/id pages from the original activation time.
This catches a batch whose final publication update arrives after another batch with a newer timestamp.
The selected original post URLs are frozen atomically in the database before the first enqueue, then saved locally.
Concurrent collectors use the same immutable selection; the delivery generation is acknowledged only after all local enqueues commit.
Recovered queues replay those saved sources even if the event's URL changes or its record is deleted.
Existing completed batches without a source receipt use their original local engagement jobs only when every selected source can be recovered faithfully; otherwise that batch is skipped for repair while other batches continue.
Queue deduplication by account and original post makes an interrupted collection safe to repeat.
Completed batches are acknowledged after all local enqueues commit, so their metadata is omitted from later cloud responses.
An interrupted acknowledgement reuses the local completion marker without reloading event items.
Apply the browser source delivery migration before installing this worker version; collection failures are surfaced until the required schema is available.

### Worker operations

Keep the Mac checkout's existing ignored `backend/.env` configured for the intended database environment, including `DATABASE_URL`.
In the commands below, `wat2do-browser` stands for `cargo run --release --quiet --manifest-path rust/Cargo.toml --bin wat2do-browser --`, run from the runtime checkout (`~/wat2do-runtime`).
Install the persistent worker, then check its heartbeat, queue counts by school/state, source collector status, and recent failures:

```sh
wat2do-browser install
wat2do-browser status
```

Run `install` again after moving the runtime checkout: it copies the new binary only when the worker's sources changed, then restarts the LaunchAgent.

The installed LaunchAgent is `io.wat2do.instagram-browser.worker`.
Its stdout and stderr logs are stored with the queue state.
Installation pauses admission and refuses replacement while jobs are running.
It flushes the replacement configuration before stopping the service and restores the previous configuration and service if replacement fails.
Replacement waits for launchd to finish unloading the previous service.
If service recovery remains uncertain, the previous configuration is preserved and browser processing stays paused for inspection.
Inspect service startup failures with:

```sh
launchctl print gui/$(id -u)/io.wat2do.instagram-browser.worker
```

For a foreground worker managed by the terminal instead of the installed service:

```sh
wat2do-browser worker
```

`worker --once` processes one bounded queued batch and does not collect source posts.
`worker --no-collect` runs the executor without periodic carousel collection.
The worker requires an already running Brave tab and a macOS user session.
It does not replace the Android notification dispatcher or GitHub runner.

Inspect a post's native controls through the queue without liking, saving, or reposting it:

```sh
wat2do-browser inspect \
  --school '<school_slug>' \
  --url '<original_instagram_post_url>'
wat2do-browser status --job-id '<job_id_from_inspect>'
```

Inspection still switches the browser to the school's account and navigates to the post.
The command returns queued job IDs immediately, so check each job's status after the worker has processed it.
Inspection uses one post job and checks all configured engagement actions without clicking.
Inspection jobs do not suppress later real engagement on the same post.

To collect eligible published selections immediately, run:

```sh
wat2do-browser sync
```

This only reads the database and appends work to the local queue.
A running worker can execute the resulting like and native repost jobs.
There is no manual command to enqueue live engagement for arbitrary posts.

Before manually logging into or fixing an account in the shared tab, pause new browser work and wait until `status` shows no running jobs:

```sh
wat2do-browser pause
wat2do-browser status
```

Pausing lets the current operation finish and prevents both digest and engagement jobs from starting.
Source polling can continue to append queued work while paused.
After resolving the account or browser issue, resume the worker:

```sh
wat2do-browser resume
```

After inspecting an uncertain action's browser state and job result, explicitly retry a failed, unsupported, or cancelled job:

```sh
wat2do-browser status --job-id '<job_id>'
wat2do-browser retry --job-id '<job_id>'
```

Retries inspect the current state before attempting an engagement click.
To remove a pending action from execution without deleting its deduplication record:

```sh
wat2do-browser cancel --job-id '<job_id>'
```

Cancellation does not interrupt an operation already running in the browser.

### Notification integration and rollout

CacheEntID workflows always target the single browser-capable Mac runner and wait when it is offline instead of falling back to Ubuntu.
Deploy the queued notification integration to the GitHub workflow's checkout and install the browser worker on the same Mac user before relying on priority scheduling.
The browser lock remains the same lock used by older direct-resolution workflows, so those versions still serialize with the worker during rollout.
Priority scheduling applies only once notification callers submit through the shared queue.
An older direct-resolution workflow waiting on the lock does not participate in queue priority.

The `process-notification` workflow submits a collapsed digest to the shared worker's queued resolver automatically.

## Android phone setup

Install Instagram and Automate on the physical Android phone through Google Play.
An authorized human must complete Instagram login, two-factor prompts, security challenges, and Automate flow import.
Keep the phone to three accounts or fewer and do not add them to a shared Accounts Center.
Import the established Automate notification listener flow and grant Automate notification access when Android asks.
The flow dispatches each Instagram notification to the `process-notification` workflow.

For each logged-in Instagram account, enable USB debugging, open the consolidated `All profiles you follow` screen on the phone, and run the existing bell configuration against the phone's serial from `adb devices`:

```sh
cd backend
python scripts/automate_bell_notifications.py --device '<adb_serial>'
```

`backend/scripts/setup_isolated_runners.sh` preserves existing runner registrations and checks their service installation.
It downloads into a private staging directory, validates the archive against the official release checksum, and reports partial setup as a repair error.
`backend/controlbox/runner_setup.json` owns the pinned runner release, command and download deadlines, retry limit, and diagnostic log retention.
Fresh installations receive those log controls in the runner's `.env` file.
Apply the same log controls to an existing runner's `.env` and restart its service only after its active workflow finishes.

The manual bell setup script uses `instagram_bell_setup.json` for command deadlines, UI waits, verification attempts, and the overall run deadline.
It uses the configured Android SDK path and requires an explicit device when multiple devices are connected.
Temporary UI dumps are isolated per call.
Repeated dump failures stop the run, and an account counts as successful only after the notification setting is verified as All.
Unconfirmed changes are reported as failures for inspection rather than retried through blind taps.

## Carousel draft selection and artwork

A daily Claude job owns event selection, carousel order, sticker choices, caption introduction, and cover copy.
`wat2do-instagram curate` (`rust/src/instagram_publishing`, binary `wat2do-instagram`) runs one Claude Code agent per school that has no draft for today, in parallel (`curation.rs`, prompt in `rust/src/instagram_publishing/curation_prompt.md`).
Each agent gets only Read access to a private folder holding the school's candidate packet and downscaled posters, and no application secrets.
Its structured answer is validated as a `DraftSelection` (`selection.rs`) and saved with `save_review_draft` (`drafts.rs`); a rejected answer is retried once with the reason.
Schools with no eligible events get an empty draft without an agent.
A packet holds the events added since the account's last carousel (`new: true`) and, when those are fewer than `fill_candidate_count`, upcoming events the account has never posted, soonest first (`new: false`), so the agent can always fill all `maximum_event_slides` slides; networking events are candidates like any other. A carousel with fewer than `minimum_event_slides` event slides is never published: the 9:35 run leaves it in review and the Publish button refuses it.
The `wat2do-instagram candidates` and `wat2do-instagram save <selection.json>` commands remain for manual review.
Every registered school receives a candidate packet and may save a review draft, even before an Instagram publishing account is connected.
The school directory is the generation roster; connected account `enabled` controls publication only.
Unconnected drafts keep `instagram_user_id` null, never a fabricated account ID.
When an account is connected later, the publishing claim validates its credentials and binds the identity atomically before any media is uploaded.
Candidate packets expose `publishing_connected` so the agent can distinguish missing accounts from reauthorization failures without blocking editorial work.
There is no embedded OpenAI API call or GitHub draft-generation workflow.
The publishing controlbox retains artwork bounds, eligibility windows, and publishing limits; there is no preset sticker catalog.
The service validates event IDs, distinct labels, capitalization, and text bounds before writing a draft.
Draft selection has no event-count quota, but it is selective.
It favors cool, exciting, high-status events students would brag about attending: formals, galas, parties, concerts, big shows, varsity games, trips, prestigious speakers or companies, and events with polished artwork.
It leaves out boring and low-status events, such as meetings, elections, study sessions, routine club meetings, generic workshops, information sessions, executive recruitment, bake sales and plainly promoted events, unless the event itself is clearly exciting.
Picks are ranked by status and energy first and artwork second, so the coolest, best-looking event is the first slide; never by date, club or packet order.
Review the actual poster before relying on artwork quality; an image URL alone is not evidence.
Clubs that asked not to be posted are rows in `public.instagram_excluded_clubs`, keyed by lowercase Instagram handle without `@`.
The DM sweep adds a row when a club asks in our DMs; add one by hand when a club asks anywhere else.
Each candidate packet carries those handles as `excluded_clubs`, the curation prompt forbids picking their events, and the outro leaves them out.
The prompt also never picks religious or political events (causes, protests, vigils, strikes, Model UN, anything hosted by an activist, advocacy or partisan group), and the outro leaves out the Politics & Advocacy and Religion & Spirituality categories.
An admin can still add such an event to a draft by hand, so check before adding one manually.
Order retained events for engaging review, without filling slots or discarding good events to fit the publishing limit.
The publishing limit applies only when the admin publishes the final carousel.

Sticker choices are saved in `instagram_publish_batches.sticker_selections` by event ID, so reordering a draft preserves them.
Migration `20261002010000_instagram_sticker_copy.sql` converts retired preset IDs into readable labels without changing published images.
Claude writes original sticker text in the school's configured language, aiming for three to four distinct benefits or practical details per event.
Prioritize price, included or explicitly free food, prizes, learning, networking and entry requirements over generic hype.
Use `Free` as the default price label unless the event states a cost, as requested by the human; this editorial default does not change the event's stored price.
Use `Reg. Required` for required registration and capitalize each word, preserving acronyms.
Each label must fit at most two lines of twelve characters each; abbreviate naturally rather than inventing or truncating facts.
Do not invent perks to reach three stickers; record when the available event information supports fewer.
Avoid relative dates that become stale while a draft waits; human review checks factual copy before publication.
Manually added events have no stickers unless they were already selected for that draft.
The admin still reviews the selected events and explicitly publishes the carousel.

Cover copy must describe the events actually selected for that carousel.
Name two to four selected events or clearly identifiable activities using accurate titles, club names, subjects, companies or activity details where useful.
For a single-event carousel, describe that event specifically.
Use one or two compact sentences in the school's configured language, ideally 120-180 characters and never more than the 280-character cover limit.
Avoid umbrella copy such as “useful workshops,” “career exploration,” “creative breaks” or “campus connection” that obscures what the events are.
Do not repeat the headline, event count, school or date already rendered on the cover.
Each named highlight and perk must be supported by a selected event's title and full description, with selected event IDs recorded in the editorial evidence.

Every carousel ends with an outro slide after the event slides.
It lists the upcoming events from the cover's count window, the last `new_event_window_hours` before the batch's `window_end`, that did not get a slide of their own, soonest first.
It lays them out as a two-column grid of miniature event cards, each with the poster, club, title, date, time and location.
The grid holds ten cards; when there are more events, the last cell becomes a "+N more" card pointing to the school's site.
When there are none, the outro points to the school's site instead.
Cover, event slides and outro must fit Instagram's ten-image carousel, so `maximum_event_slides` is eight.
The admin drawer previews the outro from the batch's `other_events`, and a published batch keeps the posted image in `published_outro_url`.

The event artwork and cover share school colors and the translucent doodle field.
Event frames are inset on all four sides, and the former comment footer remains white with only the selected stickers.
The ten sticker silhouettes and ten colors double the former visual variety.
Similar labels share a silhouette and color across events, including registration, food and entry cost.
Other labels use their normalized text to choose a consistent style.
A compact staggered row fills the 130px white footer, with shuffled positions and varied tilt instead of a fixed two-left/two-right arrangement.
The event poster fills the card width using a centered crop, with space reserved below for stickers.
Preview and published images use the same deterministic layout.
Labels render as explicit padded lines within their silhouette.
The renderer no longer requests maps or club hiring data.

### Daily publishing schedule

The `io.wat2do.instagram.curate` LaunchAgent on the Mac mini runs `wat2do-instagram curate` daily at each of the `curation_hours`, at `curation_minute`, in `backend/controlbox/instagram_publishing.json` (9 a.m., then 11 a.m., 1 p.m. and 3 p.m. Toronto).
Install or update it (and the publish job below) with `cargo run --release --bin wat2do-instagram -- install-schedule` in `rust/` of the runtime checkout.
Like the ingestion agents, both run `cargo run --release` against the checkout that installed them, from its `backend/` folder (for `backend/.env`).

The `io.wat2do.instagram.publish` LaunchAgent runs `wat2do-instagram publish` daily at `auto_publish_hour`:`auto_publish_minute` (9:35 a.m. Toronto).
It publishes every school's events draft for today that is still `ready_for_review`, one school at a time, so admins have until then to edit a draft or publish it by hand.
Curation and publishing share a file lock (`$TMPDIR/wat2do-instagram-carousels.lock`), so a publish run waits for a curation run that is still writing drafts.
Drafts saved by the later curation runs stay in review.
The admin's Publish button claims the batch in the API, which then starts `wat2do-instagram publish-batch <id>` from the binary beside `wat2do-api` as a detached process; a process that cannot start or crashes marks the batch failed.
Publishing draws each slide through the website's render route (`INSTAGRAM_SLIDE_RENDER_URL` and `INSTAGRAM_SLIDE_RENDER_SECRET`), stores the JPEGs in media storage and posts the carousel through the Graph API.
launchd runs a missed time once the Mac wakes, and a skipped day is not lost: the next draft window starts at the last successful cutoff.
The jobs keep no logs and exit non-zero when any school fails; each later run retries them, since `curate` skips schools already drafted today.
The model, parallel agents, attempts, timeout and poster size are the `curation_*` controlbox settings.
The jobs use the checkout's production configuration without printing or persisting credentials.
They do not refresh tokens; the daily account stats run does (see below).

The command interface never selects events itself and never publishes them.
Each selection JSON contains `account_key`, the candidate packet's timezone-aware `window_end`, `caption_intro`, `cover_body`, and ordered `picks` with `event_id` and `sticker_labels`.
Use an empty `picks` list when no eligible event meets the editorial quality bar, and record the exclusions.
The database's existing daily account key prevents replacing or duplicating an existing draft.
Readback uses the same service as the admin review page.
Failed or interrupted batches are reported for admin recovery and never treated as completed drafts.
Completed accounts and empty checkpoints are skipped on later runs.
Publishing remains an explicit action in the admin page.

### Music on published carousels

Instagram's API publishes a carousel without music, so the Mac adds a song from the Instagram app on the Android emulator after it is live.
Admins keep the song list in the Songs tab of the Instagram publishing admin page, typed loosely the way they would say it, such as "the weeknd after hours".
Publishing stores the live post's `permalink` and sets the batch's `music_status` to `pending`.
The emulator worker (`io.wat2do.instagram.worker`, `jobs/run_instagram_worker.py install-schedule`) visits a school's account first, at any hour, when one of its published batches has waited `music_delay_minutes` and is younger than `music_max_age_hours`. While any carousel waits for its song, visits add songs and nothing else (no DMs, follows or crawls), and a crawl slice already under way stops before its next profile. Otherwise the follow crawl runs around the clock, taking every other visit while DMs, follows or unfollows also wait: a school's crawl ends after `crawl_max_profiles` profiles, never-crawled schools go first and then the one crawled longest ago, and an account whose follow failed is retried only after `follow_retry_hours`.
On that visit it opens the live post, likes it and reposts it, then edits it: More actions, Edit, Add audio.
On the first try only (`gif_comments`), it also comments a GIF: Haiku names a well-known movie or TV scene that fits the carousel's first event (`gif_query_prompt.md`, null for none or for religious, political or grief events), the app searches GIPHY from the comment composer's GIF button, and Haiku looks at the numbered results (`gif_pick_prompt.md`) and picks a real movie or show clip or none. Tapping a result posts it at once, so nothing is tapped unless one was picked; a GIF failure never holds up the song.
Instagram's Repost label never changes and a second tap takes the repost back, so the job reads the check mark drawn inside the Repost icon from a screenshot and taps only when it is missing; the one-time "You reposted" note is closed.
It searches the songs in random order.
For each search, Claude Haiku (`music_model`, prompt in `backend/services/instagram_publishing/music_prompt.md`) reads the visible tracks and picks the one the admin meant, or none so the next song is tried.
The suggested clip is kept, the edit is saved with Done, and the batch records `added` with the track.
When Instagram has none of the songs the edit is discarded and the batch records `failed`.
An emulator error discards the edit and leaves the batch `pending`; it is tried again no sooner than `music_retry_minutes` later, until `music_attempts` runs out.
The admin drawer shows the outcome and links the live post.

The emulator is kept running by the `io.wat2do.instagram-emulator` LaunchAgent (`scripts/instagram_emulator.py install-schedule`), which boots the virtual device in `controlbox/instagram_emulator.json` whenever adb cannot see it.
Every job that drives the emulator holds its lock (`exclusive()` in `services/instagram_emulator/device.py`), so a story repost and a music edit never tap at once.
The virtual device runs the Google APIs system image, not the Play Store one, so adb can act as root; the Play Store and unused Google apps are disabled on every Android user so nothing updates or downloads in the background. Instagram needs Android's notification permission on every user (`adb shell pm grant --user <id> com.instagram.android android.permission.POST_NOTIFICATIONS`); without it, setting a profile's posts to All opens a "push notifications are off" dialog over the bell.
Its data partition is 10 GB, and Instagram never trims its own image cache, camera effects or downloaded models.
Once every `reclaim_interval_hours`, the emulator worker's `reclaim_data()` stops Instagram on each Android user and deletes the folders in `instagram_cache_paths` as root; the controlbox refuses paths that hold its login, databases or settings, so no account is logged out.
A device moved to another system image keeps its data only if the emulator's rebuilt data files are replaced with the old ones before the second boot; do it on a copy (`cp -c` clones the AVD for free) and keep the original until every account is confirmed.

### Account stats and token refresh

The Mac mini's `io.wat2do.instagram-account-stats` launchd timer (`infra/mac-mini`) runs the deployed release's `wat2do-instagram stats` daily at 6:00 a.m. Toronto.
It reads `INSTAGRAM_TOKEN_ENCRYPTION_KEY` from the production settings in `~/wat2do-data/config/backend.env`, so it is also where expiring tokens are refreshed (`rust/src/instagram_publishing/tokens.rs`), before the stats are read.
A token a person generated is stored with `wat2do-instagram import-tokens <file>`, whose leading lines are `account_key=token`.
It then reads every account with a working token through the Graph API, using only `instagram_business_basic`: followers, follows and post counts, plus the newest `stats_media_limit` posts with their like and comment counts.
`instagram_account_snapshots` keeps one row per account per day, and `instagram_account_media` holds each account's newest posts, replaced on every run.
Reach, views, saves and shares need the `instagram_business_manage_insights` permission, which the stored tokens were not granted.
The admin's Social accounts page shows every account at once, with `stats_history_days` of follower history and the song the emulator added to each carousel wat2do published.
One account's failure never stops the others, but it fails the run, which posts to Discord.

### Browser worker diagnostics

App Diagnostics has a Browser worker tab for structured queue, execution, completion, failure, pause, and resume events.
Events are persisted in the local queue before the background collector forwards them to the existing `automate_logs` table.
Safe read retries retain their failure reason in a retrying event while clearing the pending job's error fields.
Failed uploads remain local for the next collector pass, without holding the browser lock during network writes.
The admin-only log endpoint filters these events by `sender_id=instagram-browser-worker`.
Both diagnostics log tabs load once and update only when the admin clicks Refresh logs.
The worker forwards events on its existing source collection interval.
Production retains logs for seven days under the existing log retention policy.
Only allowlisted job metadata is sent; raw worker output, notification payloads, cookies, and credentials are excluded.
Existing local job history is not backfilled; lifecycle events begin when the updated worker runs.

## Direct messages

Clubs sometimes DM a school account to ask Wat2Do to share their post.
The phone's Automate flow already forwards every Instagram notification, and DMs arrive as the `direct_v2_text`, `direct_v2_media_share` and `direct_v2_clips_share` push categories.
Their `ig_action` is `direct_v2?id=<thread>&x=<message>`; a reel share also carries `clip_id`.
The notification job ignores them: the emulator worker's inbox sweep reads each school's inbox at random times instead.

The worker answers as the school in the Instagram app on the Mac's Android emulator, never in Brave, holding the emulator's lock for the whole job:

1. It switches to the Android user that holds the school's account (`android_user_by_school` in `controlbox/instagram_emulator.json`), switches the app to that account, opens `instagram://direct-thread?thread_id=<thread>`, and reads the latest `thread_item_limit` messages from the screen: who sent each one, its text, and the owner and link of any shared post (copied with the post's own Copy link).
2. Claude follows `backend/services/instagram_dms/prompt.md`, picks one outcome (`story_repost`, `feature`, `correction`, `opt_out`, `reply` or `ignore`) and writes the reply.
3. Code checks the answer against the thread and the reply against `safe_reply`, as described below.
4. `story_repost` and `feature` request a carousel spot: `events.carousel_requested_at` is set on events already listed from the shared post, or the post is queued in `public.ingestion_items` with `carousel_requested_at`, and the ingestion agent marks the events it describes (a post read before without a listing of its own is read again).
5. `story_repost` then opens the shared post, taps Share, Add to story and Your story, waits for the editor to close, and only then types the reply; `feature` just replies.
6. `correction` queues what the club wrote since our last message as a ready `dm` row in `public.ingestion_items`; the ingestion agent corrects only the listings it clearly refers to and never creates one from it.
7. `opt_out` adds the sender to `public.instagram_excluded_clubs`.
8. `reply` only sends the reply.
9. `ignore` does nothing.

When Instagram has limited an account's messages, its threads show "You can't send messages at this time" where the composer would be. The sweep then stops for that account without reading or answering anything, leaves its threads unhandled, and lists the account under `limited` in `~/.local/state/wat2do/instagram-dms/sweep.json` until a later check gets through.

Daily carousel drafts always include requested events among the candidates, however long ago they were added, until a carousel publishes them or they pass, and the curation prompt picks them first.

`controlbox/instagram_dms.json` starts with `dry_run: true`, which records each decision in the worker's job results without replying or queueing.
A dry-run job only reads, so rerunning its notification reads a failed thread again; a live DM job is never retried.
Any account's post may go to the story; the model judges whether it is appropriate and still current.
Code then requires the post to be shared in the thread with its owner readable, and an opt-out to have a readable sender.
A reply is folded to one line of plain ASCII the emulator can type, and one with a tag, a link outside wat2do.io, an email address other than `contact_email`, a long number or more than `reply_max_characters` is not sent at all.
A thread that cannot be read fails with the screen the app never showed, for example `Instagram never showed ^row_thread_composer_edittext$`.
Review those results before setting it to `false`.
Each typed reply is confirmed by seeing it appear in the thread.
A reply or story repost that cannot be confirmed pauses the worker for a person to check the thread and story, and it is never sent twice.
DM text is never logged.

