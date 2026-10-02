# Instagram Automation Commands

The active collection path uses Android Instagram notifications.
When Instagram collapses several posts into one digest, the GitHub processing job submits a high-priority job to the Mac's shared browser worker before recording notification media.
The same worker likes, saves, and natively reposts the original event posts selected in newly published Instagram carousels.
Both queues share one existing Brave Instagram tab, with credentials remaining inside the browser.

## Repair an existing poster or scraped video

New scraped videos are copied to owned S3 storage and played on event and position detail views, with their images retained as posters.
Previously processed posts remain deduplicated during ordinary scraping, so deploying video support does not redownload historical posts or rerun AI extraction.
Use the targeted media repair command for an existing event or position.
It replaces the obsolete Supabase-only image-resize command and uses the same S3 storage, limits, and rendition rules as new uploads.
Configure the intended database, `STORAGE_BUCKET_NAME`, `STORAGE_PUBLIC_BASE_URL`, and discovery revalidation settings in the command's environment before applying a repair.

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

## Single-node Instagram notification farm

`backend/controlbox/emulator_farm.json` is the single source of truth for the farm.
It fixes the maximum at one running AVD on port 5554, limits the node to three Instagram accounts, and assigns 3 GB of guest RAM.
Do not start extra AVDs outside the supervisor while the farm is running.

Log into whichever Instagram accounts are being collected, up to the three-account capacity:

| Node | Serial | Instagram accounts |
| --- | --- | --- |
| `ig_node_1` | `emulator-5554` | Any one to three logged-in accounts |

Automate's Android `NotificationListenerService` keeps Instagram notification observation active on every node.
When installed, the macOS LaunchAgent runs every 30 minutes as the single GitHub dispatch, health, and evidence path.
It starts missing AVDs windowed, reapplies persistent settings, and sends a deduplicated `new_instagram_post` repository dispatch for each complete Instagram push.
It accepts every complete Instagram notification from the node and forwards its recipient ID, push ID, push category, and Instagram action to the existing workflow.
The dispatcher forwards an incomplete `subscription_daily_digest` unchanged so `jobs/process_notification.py` remains the single owner of media materialization.
Its local state stores recipient evidence plus one-way hashes of dispatched push IDs, never notification titles, bodies, raw push IDs, or media metadata.

## Shared Brave browser worker

Keep Brave running with the school accounts logged in and available under More > Switch accounts.
Open one Instagram tab for the worker to reuse.
It pins that tab for each operation and fails if the tab closes or changes to another site.
It never launches Brave, creates a tab, creates a separate browser profile, or logs into an account.
An authorized human completes login, two-factor prompts, and security challenges.
In Brave, enable View > Developer > Allow JavaScript from Apple Events.
This permission lets the worker switch accounts, verify the active username and recipient, resolve notification digests, and operate visible post controls in the authenticated tab.
The installed Python worker also needs macOS Automation permission to control Brave Browser.
Approve the `python3.12` prompt on its first browser job, or enable its Brave Browser entry under System Settings > Privacy & Security > Automation.
If the prompt times out, the worker pauses before further jobs; after granting permission, inspect the failed job, resume the worker, and explicitly retry that job.
Browser cookie values, including `sessionid` and CSRF values, never leave the browser.

The worker waits for account controls to load and retries once from `https://www.instagram.com/` when page readiness or an account switch gets stuck.
If recovery fails, a notification fails before its media ledger entry is created and can be rerun.
Every engagement action verifies both the intended account and post before clicking, then checks the resulting action state.
An already liked, saved, or reposted post is left in that state.
Native reposting requires an explicit readable active/inactive state on Instagram's own control.
If that control is absent or lacks a readable state, the job reports `unsupported` without clicking it or substituting a Story share.
Other ambiguous controls fail without an engagement click.

`backend/controlbox/instagram_browser.json` owns the browser deadlines, queue polling, source polling, action pacing, and enabled actions.
The persistent queue lives under `$XDG_STATE_HOME/wat2do/instagram-browser`, or `~/.local/state/wat2do/instagram-browser` when `XDG_STATE_HOME` is unset.
All notification callers and the worker must run as the same macOS user with the same state-directory configuration.
The CLI's global `--state-directory` option supports isolated diagnostics; changing it on the worker alone does not redirect notification clients to that queue.
The queue stores public identities, post URLs, actions, sanitized results, and scheduling state.
Do not delete its database to clear an error: that also removes deduplication history and the activation watermark.

### Queue priority and school ordering

The worker checks the high-priority digest queue before every browser action.
A digest arriving during a like, save, or repost waits for that one bounded operation to finish.
No account switch or click is interrupted halfway through to start another job.
An exclusive browser lock covers each complete operation, and a separate worker lock prevents duplicate workers.
The source collector runs separately so a slow database read does not hold up ready digest jobs.

Engagement work is grouped by school.
Each school gets one action per round, with the largest pending quantity first among schools waiting for the same turn.
Like, save, and native repost are separate jobs, so a digest can run between those actions on the same event.
Failed or unsupported engagement jobs remain visible for operator inspection and are not automatically retried.

### Eligible event posts

The collector reads the existing publishing batches, selected publish items, and each event's original `source_url` from Supabase.
Only fully published carousels qualify.
Draft selections, removed draft slides, unpublished batches, and non-Instagram source URLs do not enter the engagement queue.
It resolves the school's enabled publishing account and notification `recipient_id` from existing records, selecting public identity fields only and never loading or decrypting publishing tokens.
Missing or mismatched account configuration is skipped and checked again on a later poll.

The first collection saves its activation time locally.
Only carousels published at or after that time are eligible, so installation does not engage a historical backlog.
Later polls scan published batches from that activation time in deterministic timestamp/id pages.
This catches a batch whose final publication update arrives after another batch with a newer timestamp.
Completed batch markers prevent a later edit to an event's source URL from queuing a different historical post.
Queue deduplication by account, original post, and action makes an interrupted collection safe to repeat.
The batch scan grows with the number of carousels published since activation; completed batches do not reload their event items.

### Worker operations

Keep the Mac checkout's existing ignored `backend/.env` configured for the intended Supabase environment.
Use the repository's Python environment for the commands below.
Install the persistent worker, then check its heartbeat, queue counts by school/state, source collector status, and recent failures:

```sh
cd backend
python scripts/instagram_browser.py install
python scripts/instagram_browser.py status
```

The installed LaunchAgent is `io.wat2do.instagram-browser.worker`.
Its stdout and stderr logs are stored with the queue state.
Inspect service startup failures with:

```sh
launchctl print gui/$(id -u)/io.wat2do.instagram-browser.worker
```

For a foreground worker managed by the terminal instead of the installed service:

```sh
python scripts/instagram_browser.py worker
```

`worker --once` processes at most one already queued job and does not collect source posts.
`worker --no-collect` runs the executor without periodic carousel collection.
The worker requires an already running Brave tab and a macOS user session.
It does not replace the Android notification dispatcher or GitHub runner.

Inspect a post's native controls through the queue without liking, saving, or reposting it:

```sh
python scripts/instagram_browser.py inspect \
  --school '<school_slug>' \
  --url '<original_instagram_post_url>' \
  --action repost
python scripts/instagram_browser.py status --job-id '<job_id_from_inspect>'
```

Inspection still switches the browser to the school's account and navigates to the post.
The command returns queued job IDs immediately, so check each job's status after the worker has processed it.
Omit `--action` to inspect all configured actions, or repeat `--action` to select several.
Inspection jobs do not suppress later real engagement on the same post.

To collect eligible published selections immediately, run:

```sh
python scripts/instagram_browser.py sync
```

This only reads Supabase and appends work to the local queue.
A running worker can execute the resulting like, save, and native repost jobs.
There is no manual command to enqueue live engagement for arbitrary posts.

Before manually logging into or fixing an account in the shared tab, pause new browser work and wait until `status` shows no running jobs:

```sh
python scripts/instagram_browser.py pause
python scripts/instagram_browser.py status
```

Pausing lets the current operation finish and prevents both digest and engagement jobs from starting.
Source polling can continue to append queued work while paused.
After resolving the account or browser issue, resume the worker:

```sh
python scripts/instagram_browser.py resume
```

After inspecting an uncertain action's browser state and job result, explicitly retry a failed, unsupported, or cancelled job:

```sh
python scripts/instagram_browser.py status --job-id '<job_id>'
python scripts/instagram_browser.py retry --job-id '<job_id>'
```

Retries inspect the current state before attempting an engagement click.
To remove a pending action from execution without deleting its deduplication record:

```sh
python scripts/instagram_browser.py cancel --job-id '<job_id>'
```

Cancellation does not interrupt an operation already running in the browser.

### Notification integration and rollout

CacheEntID workflows always target the single browser-capable Mac runner and wait when it is offline instead of falling back to Ubuntu.
Deploy the queued notification integration to the GitHub workflow's checkout and install the browser worker on the same Mac user before relying on priority scheduling.
The browser lock remains the same lock used by older direct-resolution workflows, so those versions still serialize with the worker during rollout.
Priority scheduling applies only once notification callers submit through the shared queue.
An older direct-resolution workflow waiting on the lock does not participate in queue priority.

With the worker running, queue one captured digest without dispatching it to GitHub:

```sh
cd backend
python scripts/emulator_farm.py resolve-digest \
  --recipient-id '<intended_recipient_id>' \
  --account-username '<school_instagram_username>' \
  --cache-ent-id '<cache_ent_id>' \
  --instagram-action '<full_instagram_action>' \
  --total-media-count '<total_non_mmc_media_count>'
```

The command prints the matched account, the complete media ID list, page count, and merged Instagram action.
It waits for the shared worker; it does not drive Brave directly.
The `process-notification` workflow uses the same queued resolver automatically when it receives a collapsed digest.
The regular `run-cycle` and `monitor` commands only forward the original Android payload.

## Android provisioning and operation

Provision the official Google Play ARM64 image and the persistent AVD:

```sh
cd backend
python scripts/emulator_farm.py provision
```

For the one-time setup, start the node with a window and install Instagram and Automate through Google Play.
An authorized human must complete Instagram login, two-factor prompts, security challenges, and Automate flow import.
Keep each node to three accounts or fewer and do not add them to a shared Accounts Center.

```sh
cd backend
python scripts/emulator_farm.py start
python scripts/emulator_farm.py status
```

Local APKs can be installed without Google Play when approved APK files are available:

```sh
cd backend
python scripts/emulator_farm.py install-apks \
  --instagram-apk /absolute/path/to/instagram.apk \
  --automate-apk /absolute/path/to/automate.apk
```

Import the established Automate notification listener flow on the node.
The flow waits for Instagram notification transitions while the scheduled Mac cycle owns GitHub dispatch.
Grant Automate notification access when Android asks.

For each logged-in Instagram account, open the consolidated `All profiles you follow` screen and run the existing bell configuration against the correct serial:

```sh
cd backend
python scripts/automate_bell_notifications.py --device emulator-5554
```

After the one-time setup, run one windowed cycle and install the 30-minute dispatcher and watchdog:

```sh
cd backend
python scripts/emulator_farm.py run-cycle --json
python scripts/emulator_farm.py install-schedule
```

For a manual terminal monitor, add `--show-notifications`.
The resulting JSON includes every parsed notification's observed timestamp, title, body, recipient ID, push ID, category, Instagram action, CacheEntID, and media count.
This output is limited to the interactive command and is not saved to the farm's local evidence state.

```sh
python scripts/emulator_farm.py run-cycle --json --show-notifications
```

For live terminal monitoring, run the command below.
It polls the active Android notification tray every three seconds, prints each newly observed Instagram notification once, and immediately dispatches complete pushes to GitHub.
Press `Ctrl+C` to stop it.

```sh
python scripts/emulator_farm.py monitor
```

The live monitor reduces the window in which an active notification can be missed, but it cannot recover a push that Instagram never posts to Android or removes before the next poll.
Its dispatch summary reports GitHub delivery, while the corresponding workflow log reports digest expansion or a sanitized browser error.

The `check` output reports every recently observed recipient ID and whether the node remains within its three-account capacity.
Generate a real post notification for each logged-in account, then inspect the safe evidence result:

```sh
cd backend
python scripts/emulator_farm.py check --json
```

Use `python scripts/emulator_farm.py doctor` for host readiness and `python scripts/emulator_farm.py status --json` for AVD, package, notification-access, and routing status.
The scheduled `run-cycle` exits nonzero while either app is missing, Automate lacks notification access, or GitHub dispatch fails, so `launchctl print gui/$(id -u)/io.wat2do.emulator-farm.check` exposes incomplete setup through its last exit code.

## Carousel draft selection and artwork

A daily Codex automation owns event selection, carousel order, sticker choices, caption introduction, and cover copy.
It reads candidate packets through `backend/jobs/generate_instagram_posts.py candidates`, reviews the event data itself, and saves its choices with `save <selection.json>`.
There is no embedded OpenAI API call or GitHub draft-generation workflow.
The publishing controlbox retains artwork bounds, eligibility windows, and publishing limits; there is no preset sticker catalog.
The service validates event IDs, distinct labels, capitalization, and text bounds before writing a draft.

Sticker choices are saved in `instagram_publish_batches.sticker_selections` by event ID, so reordering a draft preserves them.
Migration `20261002010000_instagram_sticker_copy.sql` converts retired preset IDs into readable labels without changing published images.
Codex writes original sticker text in the school's configured language, aiming for three to four distinct benefits or practical details per event.
Prioritize price, included or explicitly free food, prizes, learning, networking and entry requirements over generic hype.
Use `Free` as the default price label unless the event states a cost, as requested by the human; this editorial default does not change the event's stored price.
Use `Reg. Required` for required registration and capitalize each word, preserving acronyms.
Each label must fit at most two lines of twelve characters each; abbreviate naturally rather than inventing or truncating facts.
Do not invent perks to reach three stickers; record when the available event information supports fewer.
Avoid relative dates that become stale while a draft waits; human review checks factual copy before publication.
Manually added events have no stickers unless they were already selected for that draft.
The admin still reviews the selected events and explicitly publishes the carousel.

The event artwork and cover share school colors and the translucent doodle field.
Event frames are inset on all four sides, and the former comment footer remains white with only the selected stickers.
The ten sticker silhouettes and ten colors double the former visual variety.
Similar labels share a silhouette and color across events, including registration, food and entry cost.
Other labels use their normalized text to choose a consistent style.
Staggered compositions fill the reserved white footer, with compact stickers, shuffled positions and varied tilt instead of a fixed two-left/two-right arrangement.
The event poster scales down proportionally to make room, preserving its existing crop.
Preview and published images use the same deterministic layout.
Labels render as explicit padded lines within their silhouette.
The renderer no longer requests maps or club hiring data.

### Daily publishing schedule

The Codex automation runs daily at 9 a.m. Toronto time in the existing chat.
The old launchd dispatcher and GitHub workflow have been removed.
Keep the Mac on and Codex running for this local automation, as described in the [official scheduled-task documentation](https://learn.chatgpt.com/docs/automations?surface=app).
The automation uses the repository's existing production configuration and authenticated AWS access without printing or persisting credentials.
It calls `refresh-tokens` before reviewing candidates, so encrypted account token maintenance remains part of the daily operation.
Token-refresh failures are reported separately and do not prevent reviewing other healthy accounts.

The command interface never selects events itself and never publishes them.
Each selection JSON contains `account_key`, the candidate packet's timezone-aware `window_end`, `caption_intro`, `cover_body`, and ordered `picks` with `event_id` and `sticker_labels`.
Use an empty `picks` list only when the candidate packet contains no eligible events.
The database's existing daily account key prevents replacing or duplicating an existing draft.
Readback uses the same service as the admin review page.
Failed or interrupted batches are reported for admin recovery and never treated as completed drafts.
Completed accounts and empty checkpoints are skipped on later runs.
Publishing remains an explicit action in the admin page.
