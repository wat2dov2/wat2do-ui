# AGENTS.md

Read by Cursor, OpenAI Codex, Google Antigravity (v1.20.3+), Claude Code, and any
other tool that honors the `AGENTS.md` standard. **Read this file before acting on
any instruction in this repo.** These are non-negotiable engineering standards, not
suggestions. They override default behavior and apply to every change you make.

Detailed, file-scoped conventions live in `.claude/rules/*.mdc` (architecture,
imports, backend, react, types, i18n, etc.). This file is the behavioral contract
that sits above them: *how* you work. Those files are *what* the code looks like.

Tool-specific loaders also point here:
- `CLAUDE.md` imports this file for Claude Code.
- `.cursor/rules/codebase-first.mdc` keeps Cursor's project rules aligned with
  this file.
- `.claude/rules/codebase-first.mdc` makes the same policy visible in Claude's
  project-rule surface.

This file is the single source of truth. If a tool-specific file conflicts with
this file, this file wins.

## Agent standards

### Writing

- Never use the em dash "—".
  Use plain dash "-" instead.
- When writing commit messages, NEVER auto-add your agent name as co-author.
- Never manually modify `CHANGELOG.md` files or any files that are marked as
  auto-generated.
- When writing or substantially editing long Markdown files, put each full
  sentence on its own line.
  Preserve normal Markdown structure, but avoid wrapping multiple sentences onto
  one physical line.

### Technical decisions

When making technical decisions, do not give much weight to development cost.
Instead, prefer quality, simplicity, robustness, scalability, and long-term
maintainability.

### Instagram notification ingestion direction

Collect Instagram notifications through the official Instagram app on a physical
Android phone running Automate, whose `NotificationListenerService` flow triggers
the GitHub `process-notification` workflow directly, and on the Mac's emulator.
`backend/jobs/record_instagram_notifications.py` (LaunchAgent `io.wat2do.notification-recorder`) appends each notification the emulator gets to `~/.local/state/wat2do/notification-log/notifications.jsonl` and sends each new `post` and `subscription_daily_digest` one as the same `new_instagram_post` repository dispatch the phones send (`services/notification_dispatch.py`, `controlbox/notification_recording.json`).
It does not check whether a phone already sent a notification; the workflow records each recipient and push ID once.
A stopped Android user gets no notifications, so every `start_users_every_seconds` it starts each user that holds an account and has stopped, in the background (`am start-user -w`, never switched to the front).
Beyond that it only listens: no tap, never the emulator's lock.
It keeps only a direct message's push category, Android user, recipient and times, never its sender or text, and never dispatches one.
Budget no more than three Instagram accounts per device and scale horizontally by
adding devices.
The workflow records exact post URLs in the notification ledger, and a
database trigger adds each post to `public.ingestion_items`, the only ingestion queue.
The repository and its Actions logs are public: the workflow processes only `post` and `subscription_daily_digest` notifications, its `route` job ends every other category (direct messages included) with a notice naming only the category, and a notification payload never enters an `env:` block, a log line or an artifact.
The Mac's always-on processor reads each queued post logged out, with no account,
cookie or session ID, then owns extraction and database writes.
The processor is Rust (`rust/src/ingestion`, binary `wat2do-ingest`); its LaunchAgent `io.wat2do.ingestion.process` runs `cargo run --release` against the runtime checkout, so a kickstart builds and runs that checkout's code and `prompt.md`.
It runs a Claude Haiku agent that follows `backend/services/ingestion/prompt.md` and writes only events, event dates and positions through the scoped `wat2do_ingest_agent` login.
The agent draws each event's `title_svg` from its poster by the rules in `backend/services/ingestion/title_svg_rules.md`.
Each production `wat2do-api` server keeps featured events' drawings complete (`rust/src/ingestion/title_svgs.rs` `run`, with the Mac's Claude Code): every featured event to come (one Wat2Do posted in a carousel, the events feed's featured row) whose drawing is missing, does not spell its title, or would render badly on a card is drawn again, up to `controlbox/ingestion.json` `title_svg_attempts` times, then after `title_svg_retry_hours`; events that are not featured are never drawn again.
A drawing renders badly (`rust/src/ingestion/title_svg_rendering.rs`, laid out by usvg with the Mac's fonts) when its lettering runs past its view box, a line has no font size or is stretched or squeezed far from its natural width, or dark letters have no light outline; the worker draws again any featured event whose ingestion drawing fails it.
When Claude's usage limit turns an agent away (HTTP 429), or `controlbox/ingestion.json` `agent_failure_streak` agent runs fail in a row, the row goes back without spending an attempt and every agent waits until the reset Claude names, or for `agent_pause_seconds`, so an outage never fails the queue.
Every other Claude caller also treats the limit (`claude::Limited`, Python's `ClaudeLimited`) as no answer at all: a directory run stops and the next run starts over, DM threads stay unhandled, a carousel's song keeps waiting, and unscored follow candidates wait for the next run.
The same processor reads, logged out and one at a time (`controlbox/ingestion.json` `club_logo_read_delay_seconds` apart), the Instagram profile of each club that has a handle but still needs a logo (rendered by Lightpanda at `controlbox/ingestion.json` `profile_renderer`, since Instagram no longer serves profile embeds) or still carries a placeholder "@handle" name, copies its picture into media storage as the club's logo, and replaces the placeholder name with the account's real one.
A handle is read again only after `club_logo_retry_days`, and a refused read pauses these reads with the post fetches.
Haiku directory agents, not code-based parsers, read the official school directories and queue finished event details; the same binary runs them (`wat2do-ingest scrape-directories`, LaunchAgent `io.wat2do.ingestion.directories`, installed with the processor by `wat2do-ingest install-schedule`).
The same run then has Haiku club directory agents read each school's official club directory (`controlbox/ingestion.json` `club_directories`, `backend/services/ingestion/club_directory_prompt.md`, `rust/src/ingestion/club_directories.rs`), one agent per listing page every `club_directory_scan_days`, each reporting the clubs on its page with the Instagram account the page shows or else the club's own page on the directory.
Code keeps only accounts the listing page shows and pages on the directory's own site, then reads up to `club_directory_pages_per_run` club pages a run, spaced out, each again only after `club_directory_recheck_days`, and takes the Instagram accounts a page links that the site's home page does not.
Every such account its school has no follow candidate row for, and no club names, is queued for following as a pending `directory` row; which pages it read and when stay in `club-directories.json` in the ingestion state directory.
wat2do lists only student-led clubs, events and positions (clubs, societies, student unions and governments, student media and groups) plus varsity teams and their games.
Anything the university itself runs (departments, faculties, offices, services, centres, libraries, alumni, admissions, the university's own accounts) is never listed or followed: the directory prompt, the ingestion prompt and the follow scoring prompt each leave it out.
The one exception is the schools in `controlbox/ingestion.json` `university_event_schools` (OCAD University, whose clubs post too few events): there the university's own events students can attend are listed and its accounts followed too, through each prompt's `{{lists_university_events}}`.
The earlier fixed pipeline (`services/scraper/pipeline.py`, `reconciler.py`, candidate matching in `dedup.py`, and the event and position writers) is vestigial and kept on purpose; do not delete it.

When Instagram collapses a notification into "account posted and N others", the
`process-notification` job may expand that notification's CacheEntID through one
existing, human-authenticated browser tab before recording notification media.
CacheEntID workflow jobs submit through the browser-capable Mac runner to the
single installed worker.
The worker, the workflow's job and the rerun of failed runs are Rust (`rust/src/instagram_notifications`, binary `wat2do-browser`).
`wat2do-browser install`, run from the committed runtime checkout only, copies the binary to `~/.local/libexec/wat2do/wat2do-browser` when its source fingerprint (`rust/browser-worker-sources.txt`) changed; the LaunchAgents `io.wat2do.instagram-browser.worker` and `io.wat2do.notification-retry` (every `controlbox/notification_retry.json` `interval_minutes`, installed by `install-retry-schedule`, which never replaces the binary) run that copy, so macOS's Automation approval for Brave survives unrelated rebuilds; each replaced copy needs one approval and pauses the worker until then.
The workflow builds `wat2do-browser` from its own checkout once per source change (`scripts/notification-binary.sh`), before any credential is in its environment, and fails before recording anything when that binary is missing or stale.
Their AppleScript and page JavaScript live under `rust/src/instagram_notifications/scripts/`, and the local queue stays `~/.local/state/wat2do/instagram-browser/jobs.sqlite3`.
The worker owns two Instagram tabs in the existing Brave session.
The first tab is reserved for account switching and serialized likes/reposts; the second tab owns digest queries, manual profile listings and the follow crawl's Following reads.
Its queue's job kinds are `digest`, `engagement`, `retrieval` (profile listings) and `following`: one page of an account's Following list, read with the page's own `fetch` of `/api/v1/friendships/<user_id>/following/` as whichever account Brave shows (so `excluded_accounts` never holds it), never switching accounts, one at a time, at least an hour divided by `following_requests_per_hour` apart and after a pause before each next page and each new list (`controlbox/instagram_browser.json` `following_*`).
An HTTP 429 on a profile listing holds only profile listings (Instagram limits that endpoint on its own), and a 429, a login wall or any other refusal on a Following read (feedback or spam blocks, any 4xx but a plain "not found" or "private", a page in place of its JSON) holds only Following reads; a 429 on any other job holds every claim.
`wat2do-browser pause-following` stops Following reads alone, and `resume-following` lets them run again; a cancelled Following read stays cancelled.
While the worker's Lightpanda lane (below) serves any account, Following reads whose list owner's ID is known run there instead, and Brave keeps only the rest.
Brave never opens individual posts for ingestion.
Account switches wait for every tab request to settle, verify the notification's
intended recipient, and refresh each selected tab before querying.
Engagement remains serialized.
The browser's visible account switcher and active account identity are the source
of truth for matching recipient IDs to logged-in usernames.

Browser credentials must remain inside the browser.
Never read, copy, print, persist, rotate, or maintain `sessionid` values or browser
cookie jars, and never create a parallel pool of browser sessions.
Exception: after Instagram logs Brave out, the worker may log back in by clicking a
saved wat2do profile on Instagram's own logged-out page and accepting "Save info",
spaced by controlbox's backoff (`login_recovery_interval_seconds`, doubled for each other
attempt within `login_recovery_backoff_window_seconds`, at most
`login_recovery_max_interval_seconds`), never a daily cap: one left Brave logged out from
10:17 to 21:51 on 2026-11-13 and failed every school's digests.
A school account missing from the switcher is logged in the way a person adds one: switch to the `login_from_school` account, then Switch accounts, "Log into an Existing Account".
When Brave holds no other saved account, Switch accounts opens a bare login form instead of the chooser: a switch closes it and treats the account as missing, and adding an account logs in through that form directly.
When the `login_from_school` account is missing too, it is logged back in first the same way, and counts toward the same limits; when it cannot log in today, the account is added from whichever account Brave shows, and when its own submitted login does not finish, it is held, not the account being added.
Switch accounts' dialog is always closed before the worker reads the active account or gives up, since a modal hides the page's navigation.
A password prompt, there or after a logout, is answered with the account's password from the Mac's login Keychain (`login_keychain_service`), and an emailed security code is read from the Gmail inbox in `login_code_email` over IMAP.
Each account's password is entered at most once a day and `account_login_daily_limit` a day in all, whether it is added or logged back in after a logout; a login is recorded just before its password goes out, so a failure before that spends nothing.
Once a password has been submitted, any failure (including a timeout) is never retried automatically for that account: it holds only that account (its jobs fail as unavailable, `accounts_paused` in `wat2do-browser status`) until `wat2do-browser resume-account --account <name>`, and every other school keeps running; after a logout, the next recovery attempt tries the other saved profiles, so browser work never waits for a person while any saved profile can get back in.
Passwords go to the page through osascript's stdin, never a command line, log or file.
A refused password or any other challenge holds that account for a person.
A digest whose account is missing and cannot log in yet marks it missing (`accounts_missing` in `wat2do-browser status`) until its login is allowed again or a digest finds it in Brave.
`io.wat2do.notification-retry` reruns failed Process Notifications runs: none while the worker is paused or down, never one whose account is held or missing, and each run at most `max_reruns_per_run` times, `rerun_spacing_minutes` apart, so a run's posts are ingested within minutes of the worker recovering.
Second exception (approved 2026-11-03): digests can be read with Lightpanda instead (`rust/src/lightpanda`, binary `wat2do-lightpanda`), one `lightpanda serve` process per school account, each with its own owner-only (0600) cookie jar in `~/.local/state/wat2do/instagram-browser/lightpanda/`.
The worker may create, keep and replace those jars and log the accounts in to them itself, typing the Keychain password and the emailed code over CDP on an owner-only Unix socket; neither, nor any jar's contents, is ever logged, copied elsewhere or put on a command line.
An account counts as logged in when its jar holds a non-empty `sessionid`.
Lightpanda logins share Brave's budget above, and first logins (a new device to Instagram) are also capped at `controlbox/instagram_lightpanda.json` `new_login_daily_limit` a day.
A wrong password, a security check or any page the login does not recognise pauses that account until a person runs `wat2do-lightpanda resume --account <account>`.
These sessions are the one parallel pool of browser sessions allowed: the worker's Lightpanda lane (`rust/src/lightpanda/lane.rs`, a thread of `wat2do-browser`) keeps each served account's session open while it has work, at most `controlbox/instagram_lightpanda.json` `max_sessions` Lightpanda processes on the Mac at once (about 250 MB each), never two for one account.
It serves every account whose jar holds a login and that is neither paused, excluded nor held, and says so in the queue with a heartbeat; Brave reads everything else, and everything once that heartbeat is `lane_stale_seconds` old.
With `controlbox/instagram_digest.json` `digest_engine` `"lightpanda"`, a served account's digests are read in its own session (with `"brave"`, today's setting, Brave reads them all), each within `lane_digest_timeout_seconds` opening included; a digest Lightpanda cannot read, or leaves waiting `lane_digest_wait_seconds`, goes to Brave.
Every served account reads Following lists at its own pace (Brave's `following_*` values, per account), so the crawl's reads spread over all of them; a 429, a login wall or a refusal holds only that account, and Brave reads Following lists only while the lane serves no account.
Brave's pauses and holds never stop the lane, Brave's queue recovery leaves the lane's running jobs to it while its heartbeat is fresh, and the lane's reads never touch Brave's Following pace or backoff; a session Instagram logged out makes its jar forget the login.
At most every `ramp_interval_minutes` (kept in the queue across restarts) the lane logs one more account in, the accounts with the most digests first, within the budgets above and never spending the day's last `ramp_reserved_logins` logins, which Brave's relogins need.
Every login's budget check and record happen in one queue transaction, and from the first keystroke of a Lightpanda password on, any failure pauses that account for a person.
School accounts' direct messages are not taken from notifications.
One Mac LaunchAgent (`backend/jobs/run_instagram_worker.py`, `io.wat2do.instagram.worker`) is the only thing that drives the emulator (`backend/services/instagram_worker.py`).
It visits one school account at a time: it picks the account with the most urgent work (a carousel waiting for its song, then an inbox due a check, then follows), switches the app to it once, and does everything that account needs before moving on.
Each inbox is checked at random times, a random gap set in `controlbox/instagram_dms.json` after each check.
Replies, follows and post edits happen only between `controlbox/instagram_emulator.json` `action_start_hour` and `action_end_hour`; outside them the worker only reads.
One failing step never stops the visit's other steps.
The worker never touches Brave.
It runs in the official Instagram app on the Mac's Android emulator
(`controlbox/instagram_emulator.json`), because Instagram's website cannot add another
account's post to a story and the app is the one place that can do every step.
The emulator holds every school account, logged in once outside this automation and
spread across Android users because the app keeps at most ten accounts each.
Each visit holds the emulator's lock and switches to the school's Android user and
account; the DM step then lists the main inbox and message requests.
It opens, by tapping its row, each unread thread with a message it has not handled,
and each read thread it has never handled (a read thread may show who is active
instead of its latest message), skipping threads whose newest message is over a week
old, and reads who sent each message, its text and any shared post from the screen
the app draws.
A message request is accepted only when we answer it, or when reading a post it shares
needs the composer.
It then asks Claude (`backend/services/instagram_dms/prompt.md`) for one outcome and
writes our reply the way a student running the account would, from the facts about
Wat2Do the prompt lists.
The outcomes are sharing a post or reel to our story (any account's, if it is
appropriate and not out of date), featuring it in an upcoming carousel, correcting a
listing the club says is wrong, leaving a club that asks out of carousels,
a plain reply (questions, a story request with no post shared, an event already over),
or ignoring it with no reply (traps, spam, "thanks").
Clubs want story reposts and carousel spots, so replies never ask about adding things
to the site.
A story repost or carousel request sets `events.carousel_requested_at` on the events
listed from the shared post; a post not listed yet is queued in `public.ingestion_items`
with the request, and the ingestion agent marks the events it describes.
Daily carousel drafts always consider requested events, however long ago they were
added, and rank them first.
A correction queues the club's words as a `dm` row in `public.ingestion_items`, and the
ingestion agent corrects only the listings it clearly refers to.
An opt-out adds the sender to `public.instagram_excluded_clubs`.
A story request is shared first and answered after: the app adds the shared post to
the school's story, and only then does the thread get the reply.
The emulator finds every control by its accessibility label, taps at a random point
inside it after a random pause, types one character at a time, and never types a
password.
It reads each screen through `ScreenReader.java` (`backend/services/instagram_emulator`), `uiautomator dump` kept running while the emulator is held, rebuilt into the committed `screen-reader.jar` by `scripts/build_emulator_jars.py`, which builds the notification recorder's `notification-reader.jar` too.
Each reply is confirmed by seeing it appear in the thread.
The emulator also likes, reposts and adds music to our own carousels after the API
publishes them, since the API can do none of these: on the school's next visit the
worker opens the live post, likes it, reposts it unless the Repost icon already shows its check mark, then
Edit, Add audio,
searches the admin's song list in random order, and Claude Haiku picks the matching
track or none.
The same edit tags the post with the school's own place: the first one Instagram's location search lists under the school's exact name (`schools.name`), else the one Claude Haiku recognizes as the school, or none; a place that cannot be tagged never holds up the song.
A song the admin marks as Asian or K-pop is tried only at the campuses in
`controlbox/instagram_publishing.json` `asian_song_schools`.
The emulator also follows the clubs each school account should follow, and the follow crawl finds them through the browser worker.
`public.instagram_follow_candidates` is the one queue of accounts to follow: any feature that wants an account followed adds a row there with its `source` (`crawl`, `club`, `import` or `directory`), and nothing else follows accounts.
One row per school and handle is kept whatever its status, so an account an admin rejected is never offered again.
Every listed club's Instagram account goes in approved for its school (`sync_club_targets`); crawled accounts wait for review.
Accounts a school's official club directory lists come from the club directory agents as pending `directory` rows whose `found_via` names the directory, and the scorer decides them like crawled ones, told which directory lists each; one found for a club of ours without an account is linked to that club, so approving it gives that club the account instead of making a second club.
Crawling (`backend/services/instagram_follow/crawl.py`) never stops: a crawl under way goes first, then schools never crawled, then the school whose last crawl finished longest ago, so a school whose crawl ends is crawled again once the schools that finished before it have had their turn.
It reads Following lists only through the browser worker's `following` jobs (`wat2do-browser following`, collected with `status --job-id`, checked less often the longer a read waits), keeping one read outstanding per school and crawling as many schools at once as the worker has Following readers (`status` `following.readers`), and runs in its own thread of the emulator worker's process, restarted if it ever stops, without ever touching the emulator.
Every crawl starts over from the school account's own Following list (read by its `recipient_id`, to its end): every public account the school follows is a seed, and each seed's whole Following list is read in turn, at most `crawl_list_page_limit` pages deep.
A public account the school does not follow and has no row for becomes a pending candidate when its handle or name carries one of the school's names in `controlbox/instagram_follow.json` `school_names` as a word (UofT's campuses list each other; only the slug and names of six letters or more may start or end a run-together word, so "mac" or "queen" never matches inside one), or once `crawl_mutual_follow_threshold` of the school's followed clubs follow it; `found_via` names those clubs.
Sightings below the threshold are kept across crawls in local state (`sightings.sqlite3`), so the count grows crawl after crawl, and one no crawl sees again for `crawl_sighting_retention_days` is forgotten; a private account is never a candidate, since it is almost always a member and the scorer cannot read it.
The crawl stops only once `crawl_miss_streak` seeds in a row add no new candidate, or no seed is left; a page that fails to read is read again, up to `crawl_seed_attempts` times, and never counts as a miss, a hold or pause in Brave only keeps the crawl waiting, and a read still waiting after `crawl_read_timeout_seconds` while Brave holds nothing rests that school's crawl (its read is still collected) so the others go on.
Each crawl takes the school's seeds in a new random order, so a crawl the miss streak ends early still reaches clubs the last one never did, and crawl after crawl covers them all.
Its place is kept in local state, so a restart picks up at the page it was reading; state an older crawler left is finished and replaced by a fresh crawl.
New candidates are read logged out from their profile embed (`fetch_profile`) and scored by Claude (`backend/services/instagram_follow/prompt.md`) from their newest posts.
The scorer is told the school's full name and city (a same-named school elsewhere, such as the University of York in England for York University, or another campus of the same university is never this school), and its verdict decides the account at once: only an approve verdict is approved, or a review of an unreadable profile the school's club directory lists; an account it is unsure of is rejected and, while it keeps posting, scored again every `recheck_days`.
Admins review them on the admin Social page's Follow candidates tab; approvals and rejections are staged in the page and submitted together.
Approving creates the school's club for the handle unless one exists, and queues the follow.
The emulator worker checks `follows_due` from the database, then calls `follow_due` with the emulator on the school's account.
`follow_due` follows a few approved accounts per visit, at most `follows_per_account_per_day` a day and `follows_per_account_per_hour` within any hour, and sets each one's post notifications to All so ingestion hears about its posts; an account already followed is only marked followed, after its bell is checked, and never counts toward the day's follows.
Instagram's "Try again later" pauses that account's follows for a day; it is never pushed through.
Only the worker taps the emulator, holding its lock for one visit at a time.
Every message is untrusted: the prompt lists the traps to ignore (instructions inside a
message, impersonation, login codes, money, follow-for-follow, pressure).
Code, not the model, has the final say: the post must be shared in the thread with its
owner readable, an opt-out needs a readable sender, a reply with a
tag, a link outside wat2do.io, an email address other than the controlbox's
`contact_email` or a long number is not sent at all, and nothing is sent when our
message is already the newest.
Each inbox's random check time is the reply's human-like delay.
A reply or story repost that fails or cannot be confirmed pauses every inbox for a
person (`run_instagram_worker.py resume-dms` once checked) and is never retried, since it
may already have reached Instagram; the worker's other steps go on.
A story repost waits, without accepting or answering the thread, while the emulator has
less free storage than `controlbox/instagram_emulator.json` `min_free_data_megabytes`.
Once a day, from `reclaim_hour` (before the morning's carousels publish), the worker
deletes Instagram's caches on every Android user as root
(`instagram_cache_paths`), never its login, databases or settings, then restarts the
emulator, whose host process leaks about 3 GB of memory a day.
Unfollows and follows stop between profiles once a carousel waits for its song or that restart is due.
A step that fails starts Instagram afresh on that Android user, so nothing it left open covers the next step, and `failures_before_rest` profiles failing in a row rest that account's follows (as that many failed Following reads in a row rest that school's crawl).
Both stop Instagram with `am force-stop`, which also leaves an app in Android's stopped state, getting nothing in the background until it is opened again, so `pm unstop` follows every one; the reclaim never clears another app's data (clearing Google Play services dropped the Android users' device registration).
`dry_run` decides and records every DM without replying, reposting or queueing anything.
Never log DM text.

If serialized browser expansion cannot complete, fail before recording that
notification's media so the workflow can be rerun safely.
Other notification workflow runs must remain independently processable.

Secrets and Instagram credentials must still follow the repository's existing
secret-storage rules and must never be committed.

### Rust services

The backend is being ported to Rust one component at a time, in the single crate under `rust/`.
A ported component replaces its Python code in the same change; never keep both running.
Rust reads the same `backend/controlbox/*.json` (embedded at build time), `backend/.env` settings and Postgres tables as Python, and talks to Postgres directly through `DATABASE_URL`.
Constants Rust mirrors from `backend/core/constants` live in `rust/src/constants.rs`, guarded by `backend/tests/test_rust_constants.py`.
The scheduled notification emails (morning email and event reminders) are sent by `wat2do-send-notifications` (`rust/src/notifications`, `rust/src/email`), which the Mac mini's hourly `io.wat2do.scheduled-emails` launchd timer (`infra/mac-mini`) runs from the deployed release; event change emails (`jobs/send_event_change_alerts.py`, which `wat2do-api` runs as a child process for each authenticated `POST /webhooks/event-change-alerts`) is still Python and shares `notifications_log`, the unsubscribe token format and the email layout with it, and the API's preference and unsubscribe routes (`rust/src/api/routes/notification_preferences.rs`) verify that token.
The monthly promoter poster payouts are computed by `wat2do-poster-payouts` (`rust/src/poster_payouts`), which the Mac mini's monthly `io.wat2do.poster-payouts` launchd timer runs from the deployed release; `--plan` shows what a run would write without writing.
Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `rust/` alongside the backend checks.

The public API is served by `wat2do-api` (`rust/src/api`), which listens on port 8000, runs the FastAPI app on loopback as its child, answers the routes already ported to Rust and proxies every other request to Python unchanged.
Porting a router means writing its handlers with the shared extractors, errors and validation in `rust/src/api`, registering them in `rust_routes()`, regenerating `backend/core/rust_openapi.json`, proving parity with `backend/scripts/api_parity.py` against production read-only, and deleting the Python router, service, schemas and tests in the same change.
`docs/rust_api.md` is the step-by-step guide.
The admin's carousel routes are Rust (`rust/src/api/routes/instagram_publishing`), and so are the carousel jobs (`rust/src/instagram_publishing`, binary `wat2do-instagram`): Claude's daily drafts (`curate`, LaunchAgent `io.wat2do.instagram.curate`), the 9:35 publish (`publish`, `io.wat2do.instagram.publish`), both installed by `wat2do-instagram install-schedule` and run with `cargo run --release` against the installing checkout, and the daily token refresh and account stats (`stats`, the Mac mini's `io.wat2do.instagram-account-stats` timer, from the deployed release).
The Publish button claims the batch in Rust, then starts `wat2do-instagram publish-batch <id>`, the binary beside `wat2do-api`, as a detached process from the API's working directory, and a process that cannot start or crashes marks the batch failed.
Liking, reposting and adding music to a published carousel stay in the Python emulator worker (`services/instagram_publishing/music.py`).
Each `wat2do-api` server also runs the map location worker (`rust/src/map_locations.rs`), which looks up waiting `map_locations` with Nominatim; `claim_map_location` keeps every server to one lookup at a time between them.
Uploads (`/uploads` and the `/ai` poster readers) are checked and stored in Cloudflare R2 (with the thumbnail of each poster and raster club logo) by `rust/src/storage.rs`, and posters are read by OpenAI with `backend/services/scraper/extraction_prompt.txt`, the template the vestigial Python extractor renders too; Python's `storage_service` remains only for that pipeline and scripts.
Read-only production checks must `SET default_transaction_read_only = on`, a 10 second `statement_timeout` and a 15 second `idle_in_transaction_session_timeout` on every connection (at most 2), confirm read-only with `SHOW`, run one at a time and never retry a failed run.

### Club tickets and money

Clubs give out free tickets and sell paid ones to their events; both are the same tickets at the door (`rust/src/api/tickets`).
Paid tickets go through each club's own Stripe Connect Standard account, which the club signs in to itself: every charge is a direct charge on the club's account, so ticket money never sits with wat2do, and the club pays Stripe's fees and carries its refunds and disputes.
`rust/src/api/tickets/stripe.rs` is the only code that calls Stripe, and each call that touches money names the club's connected account.
Never use live Stripe keys outside production, never log or store card details, and keep Stripe keys in `backend/.env` locally and the Mac's `~/wat2do-data/config/backend.env` in production.
Webhooks are trusted only with a valid, recent Stripe signature, and every charge and refund carries an idempotency key so a retry can never charge or refund twice.
Read `docs/club_tickets_runbook.md` before changing tickets or turning paid tickets on.

### Bug fixes and testing

When doing bug fixes, always start with reproducing the bug in an E2E setting as
closely aligned with how an end user experiences it.
This makes sure you find the real problem so your fix will actually solve it.

When end-to-end testing a product, be picky about the UI you see and be obsessed
with pixel perfection.
If something clearly looks off, even if it is not directly related to what you are
doing, try to get it fixed along the way.

Apply that same high standard to engineering excellence: lint, test failures, and
test flakiness.
If you see one, even if it is not caused by what you are working on right now,
still get it fixed.

### Never spin up browsers or long-running servers

Browser instances eat RAM on this machine, so agents never launch one.
Do not start a browser, browser preview pane, Playwright/Chromium run, or any
headless/headed browser automation on your own initiative.
Do not start dev servers, preview servers, or backend processes either
(`npm run dev`, `next dev`, `uvicorn`, `docker compose up`, preview tooling).
These are the human's to run.

This overrides any default agent behavior that says to verify a change in a
browser preview, and it qualifies the E2E guidance above: reason about the user
flow and write or update the E2E test, but leave running it to the human.

Verify with the checks that do not need a browser or a server:
`npm run check` in `frontend/` (lint, i18n audit, type-check) and the backend
test suite.
Then report exactly what you ran, and state plainly which checks you could not
run because they need a browser or a running server, so the human can run them.

The only exception is an explicit, in-the-moment request from the human to open
a browser or start a server.
The scheduled competitor pain point sweep is a standing, human-approved exception:
`backend/services/competitor_pain_points/x_browser.py` opens and closes its own
Safari window to read X search results in a session a person logged in.
It only reads what the page shows, never posts, likes, replies or follows, and
never reads or stores cookies; it never uses the Instagram worker's Brave.
The worker's Lightpanda (`rust/src/lightpanda`, its lane in `wat2do-browser` and the `wat2do-lightpanda` commands) is the other standing exception: at most `controlbox/instagram_lightpanda.json` `max_sessions` headless processes at once, one per account, each stopped once its account has no work.
Standing permission from an earlier task does not carry over.
When you are done with anything you were explicitly asked to start, shut it down.

### Production API profiling

Use `backend/scripts/profile_production_api.py` for production endpoint profiling.
Do not create an ad hoc profiler or manually maintain a second endpoint inventory.
The script authenticates through OTP, profiles only classified safe GET routes,
and writes every successful run to a UTC-timestamped directory under `/tmp`.
Each run directory contains `profile.json` and `latency-distributions.svg`.
The script prints the run-directory path when it completes.

The profiler calls `app.openapi()` from the local checkout at runtime.
That schema includes every GET route registered on the FastAPI application in that checkout, plus the routes the Rust API server serves (`backend/core/rust_openapi.json`, merged by `backend/core/openapi.py`).
It does not prove that production is running the same commit, so confirm deployment
alignment before treating route coverage as production-complete.
Any unclassified or stale GET route reported by the profiler must be resolved before
using the run as a complete baseline.

Read `docs/production_api_profiling_runbook.md` before profiling.
Keep the default one warm-up and ten measured requests for the regression
baseline unless the human requests another mode.
Use zero warm-ups when the goal is first-observed-request behavior.
Every successful endpoint result must report mean, median, p95, minimum, and maximum
latency regardless of the configured sample count.

### Database schema and seed maintenance

Migrations live in `backend/database/migrations` as `<14-digit version>_<lowercase_name>.sql`, dated after the newest migration on `origin/main`.
`scripts/migrate-database.sh` applies them in version order, records each in `public.schema_migrations` and then tells the data API (PostgREST) to reload its schema cache, without which it cannot see new tables or columns; the deploy job runs it against production before the new code ships.
Treat `backend/database/seed.sql` as part of every database schema change.
Audit it and update it in the same change whenever tables, columns, constraints,
or required relationships used by seeded data change.
Verify the migration and seed together with `make db-reset`.

### Python Dependencies

Our CI uses a locked dependency file for caching and reproducibility. 
Whenever you add or change a dependency in `backend/requirements.txt`, you **MUST** regenerate the lockfile by running `uv pip compile requirements.txt -o requirements.lock --python 3.12` in the `backend/` directory before committing.

---

## Prime directive

You are working in an organized codebase. Your job is not to generate isolated
code; your job is to modify the existing system while preserving one clear,
consistent way of doing things.

Before writing or changing code, study how this codebase already solves the
closest similar problem. Match the existing architecture, folder placement,
naming, data flow, helper patterns, API conventions, and testing style. Do not
introduce a second way to do something that already has an established path.

If no existing pattern fits, stop and explain:
- what patterns you checked,
- why none fit,
- the smallest new pattern you propose,
- what old or duplicate code will be removed or consolidated.

## 0. Match the existing pattern first

Before writing code, study how this codebase already solves the similar problem and
follow that exact pattern. **Do not introduce a second way of doing something that
already has an established approach** (e.g. a new cache/store/lib/util/hook for one
feature when one already exists). If no clean existing pattern fits, **say so and
propose one before implementing** - do not invent silently.

## 1. One path

After your change there must be exactly **one obvious way** this thing is done. No
backwards-compat shims, aliases, dead flags, or "duct tape" kept "just in case." If
you replace something, **delete the old thing** in the same change.

Do not add:
- compatibility wrappers,
- aliases for renamed APIs,
- duplicate helpers,
- near-copy utilities,
- legacy fallback branches,
- "just in case" flags,
- ignored request fields or response fields,
- parallel frontend/backend representations of the same concept.

## 2. No duplication

If logic resembles code that already exists, **extract a single shared source of
truth** and route both callers through it - do not rewrite a near-copy. Name it so
its intent is obvious.

## 3. Leave nothing stray

After the change there must be **no dead code, unused imports/constants/locale keys,
orphaned tests, or now-meaningless params** on either side of an API/wire contract.
**Audit the whole codebase for fallout, not just the file you touched.**

## 4. Keep call sites dead-simple

Business logic, routing, and controllers stay simple enough that a new dev reads
them and immediately sees the goal. Push plumbing and complexity **down into
well-named helpers** and out of the call sites.

React components, hooks, routers, services, repositories, and scripts should read
as straightforward orchestration. If the call site starts explaining mechanics
instead of intent, move the mechanics into the existing appropriate layer.

## 5. Coordinate both sides

Frontend and backend - request params, response shape, and types - must agree
**exactly**. No client sending fields the server ignores; no server returning fields
the client never types.

Schemas, generated API types, validators, service payloads, request builders, and
UI consumption must all line up. If one side changes, audit the other side in the
same change.

## 6. Reuse before create

Before creating any new file, helper, hook, service, store, schema, endpoint,
component, migration utility, type, or test fixture:

- Search the repo for existing equivalents.
- Inspect the closest matching implementations.
- Reuse or extend the existing source of truth when appropriate.
- Put the code where this repo already puts that kind of code.
- Only create something new if the existing structure clearly has no correct home.

Do not create new folders, libraries, abstractions, or naming schemes unless the
repo already uses that pattern or the human explicitly approves it.

## Feature control boxes

Every feature that owns non-secret operational values, tuning parameters, account
identifiers, limits, or other control-box-like configuration must keep those
values in exactly one feature-named JSON file under `backend/controlbox/`.

Do not place feature control values in a repository-wide aggregate file, duplicate
them across frontend and backend constants, or hide them in unrelated modules.

Backend consumers must read the validated `core.controlbox.controlbox` source.
Frontend consumers may import only the specific feature control files they need.

Secrets and environment-specific credentials never belong in control-box files.
Keep secrets in ignored local `.env` files and the production Mac's
`~/wat2do-data/config/backend.env`, with only the corresponding typed runtime
setting in source code.

When adding a feature control file, extend the validated control-box schema and
tests in the same change.
When removing or replacing a control value, delete the old source in the same
change.

## Frontend cleanup mandate

Frontend cleanup means reducing concepts, not moving mess.
Every touched frontend path must end with fewer responsibilities, fewer public exports, fewer hidden side effects, or a clearly documented reason it cannot yet be simplified.

When cleaning frontend code:
- Keep `src/app` route files as thin routing shells that delegate to `src/app/client-routes.tsx`, `src/app/routes/*`, or feature page containers.
- Keep feature page containers as orchestration only: load data, call hooks, choose layout, and pass named props.
- Keep React components presentation-first: render UI, delegate state transitions to colocated hooks or reducers, and delegate domain work to feature API/query helpers.
- Treat TanStack Query as the source of truth for server state and use `src/shared/lib/queryClient.ts` plus `src/shared/lib/queryKeys.ts` for cache ownership.
- Do not mirror server state into Zustand or React context unless a consumer truly needs a client snapshot.
- When a client snapshot is needed, name it as a snapshot and keep writes routed through the query cache or feature API.
- Keep stores for client state, optimistic UI glue, auth/session broadcasts, or persisted preferences only.
- Do not create new fetching hooks, cache keys, browser-storage helpers, or state stores until you have searched for the existing equivalent and either reused it or deleted the duplicate path.
- Keep feature public surfaces small: cross-feature imports should use the feature `index.ts` only for intentional public API, and internal imports should stay inside the owning feature.
- Prefer deleting stale exports, props, wrapper components, unused locale keys, and duplicate helpers over adding new layers.
- Split large hooks/components only along real responsibility boundaries: data fetching, URL state, derived view model, form state, and presentational UI.
- Do not perform cosmetic file shuffling or rename churn unless it removes an implementation path or makes ownership unambiguous.
- Before ending any frontend cleanup, search for old imports and dead exports, run the frontend checks, and report anything still duplicated.

---

## Design system mandate

- **Every UI change must be implemented at the lowest-level reusable owner of that appearance or behavior.**
  A request that names one page or one component instance does not make that call site the owner of the design decision.
  Trace the rendered element down through feature components, layout primitives, UI primitives, variants, and tokens, then change the lowest shared layer that semantically owns the requested result.
- **Never fix a UI detail by styling the individual instance on a page.**
  Pages and feature call sites may select semantic props or variants, provide content, and express business state, but they must not patch a shared component with local Tailwind classes, inline styles, arbitrary selector overrides, or one-off hover, focus, spacing, color, typography, radius, border, or shadow rules.
- If a Contact page button should no longer underline on hover, change the appropriate `Button` or `Link` variant in `frontend/src/shared/ui/`.
  Do not remove the underline by adding or overriding a class on the Contact page instance.
  If the existing variant's semantic contract should keep its current appearance, add or refine the smallest meaningful semantic variant in the owning UI primitive and have the page select it.
- Apply the same ownership rule at every layer.
  Theme-wide values belong in semantic tokens, primitive behavior belongs in `frontend/src/shared/ui/`, reusable structure belongs in layout primitives, and feature-specific composed appearance belongs in the lowest shared feature component that owns it.
  Page-level code owns composition and business intent, not the visual implementation of its children.
- Before editing any UI call site, inspect the rendered component's source, its selected variant, and the tokens used by that variant.
  A UI change is incomplete if the final design decision still lives in a page-level `className` or inline style when a lower reusable owner exists.
- Do not create a page-specific wrapper, duplicate variant, or narrowly named prop merely to hide a local style override.
  The resulting API must describe a reusable semantic distinction, and there must remain one obvious source of truth for the appearance.
- Build the design system around semantic tokens (`surface`, `primary`, `foreground`) instead of raw Tailwind colors like `bg-white` or `text-gray-500`, so the UI can be re-themed from one place.
- Separate functional tokens (backgrounds, text, borders, buttons) from decorative tokens (gradients, glows, colorful badges, background orbs) so branding does not leak into core UI code.
- Install shadcn/ui components as a starting point, but treat them as our own source code: customize them, remove unused variants, and evolve them instead of leaving them untouched.
- Organize components into three layers: UI primitives (Button, Input, Card), layout primitives (Container, Stack, FormGrid), and feature components (EventCard, ClubCard).
- Pages and feature components must compose existing UI and layout primitives by selecting semantic variants.
  They must not hand-roll visual styles in `className` when a token, primitive, layout helper, feature component, or component variant owns the design decision.
  If the needed semantic distinction does not exist, add it to the lowest owning component and use that single variant instead of styling call sites.
- A page's `Container` is the single owner of its width: the `PageHeader` and the content below it always share that width, so the back button and title line up with the content.
  Content components never cap or centre themselves (`mx-auto max-w-*`).
  Pick the `Container` size that fits the page's content; a step that is naturally narrower than the rest of its page marks itself `data-content-width="sm"` and the `Container` narrows, header included, while it shows.
- Use layout primitives for page and feature structure, including flex direction, grid columns, alignment, wrapping, spacing, sections, and form actions.
  A genuine one-off positioning constraint may remain at a call site only when it describes that instance's relationship to its parent, no reusable owner can express it, and the reason is documented beside the class.
  It must not encode the child component's visual design or interactive states.
- Render page-level back and all navigation through the `PageHeader` `back` prop as the first control at the top-left of the page.
  Do not hand-roll page-level arrow buttons at call sites.
  Workflow-internal previous and back controls are excluded.
- Create small layout helpers like Container, Stack, FormSection, FormGrid, and FormActions so building pages and forms feels like assembling LEGO rather than rewriting spacing and grid classes.
- Keep component APIs intentionally small by exposing meaningful variants (primary, secondary, ghost) instead of dozens of styling props that try to cover every visual possibility.
- Define interaction tokens such as `surface-hover`, `primary-hover`, and `destructive-hover`; derive them from the base colors (typically by slightly reducing lightness) instead of choosing unrelated hover colors.
- Use `frontend/src/shared/ui/tabs.tsx` for every tabbed content-navigation surface, with the User Settings tab bar as the canonical appearance.
- Do not add tab appearance variants, hand-style tab buttons, or override `TabsList` and `TabsTrigger` visuals at call sites.
- Use a dedicated design system showcase page (or Storybook) to preview every component and variant in one place, making it easy to maintain visual consistency as the system evolves.
- Follow one guiding principle: design decisions should live in tokens and reusable components, while pages focus only on composing layouts and business logic, resulting in a codebase that is easy to maintain, extend, and rebrand.

---

## Required workflow for every non-trivial task

**Before you start, report:**
- **(a) Existing pattern matched:** files inspected, symbols/functions/components
  reused or mirrored, and the convention being followed.
- **(b) Exact blast radius:** every file expected to change, every symbol affected,
  deletions or consolidations planned, and frontend/backend/API/type/test impact.
- **(c) Scope-expanding decisions:** anything that changes architecture, introduces
  a new abstraction, moves ownership, deletes a legacy path, or affects more than
  the requested feature.

If a scope-expanding decision is needed, ask for confirmation before implementing.

**Then implement.**

While implementing:
- Prefer editing existing code over adding new code.
- Prefer deleting duplicate code over preserving compatibility.
- Keep changes tightly scoped.
- Preserve the repo's style, imports, naming, and error handling.
- Do not leave unused imports, unused constants, dead locale keys, orphaned tests,
  dead branches, or meaningless params.
- Audit the whole codebase for fallout, not just the touched files.

**Then verify and report what you ran:**
- the test suite,
- typecheck,
- lint.

Do not claim done until these pass (or you've reported exactly why one can't run).

## Pushing to `main`

Any agent landing work on `main` must follow [`PUSH_TO_MAIN.md`](PUSH_TO_MAIN.md)
end-to-end before `git push`. That checklist mirrors CI/CD exactly.
