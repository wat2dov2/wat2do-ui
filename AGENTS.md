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
the GitHub "Handle notification" workflow (`.github/workflows/handle-notification.yml`) directly, and on the Mac's emulator.
`backend/jobs/record_instagram_notifications.py` (LaunchAgent `io.wat2do.notification-recorder`) appends each notification the emulator gets to `~/.local/state/wat2do/notification-log/notifications.jsonl` and sends each new `post` and `subscription_daily_digest` one as the same `new_instagram_post` repository dispatch the phones send (`services/notification_dispatch.py`, `controlbox/notification_recording.json`).
Each new notification in `agent_push_categories` (direct messages, message requests, story mentions, comments) goes out instead as an `instagram_interaction` dispatch carrying only its category, school account, sender's name and time, never its text, for the notification agent (below).
It does not check whether a phone already sent a notification; the workflow records each recipient and push ID once.
A stopped Android user gets no notifications, so every `start_users_every_seconds` it starts each user that holds an account and has stopped, in the background (`am start-user -w`, never switched to the front).
Beyond that it only listens: no tap, never the emulator's lock.
A direct message's line in the file keeps only its push category, Android user, recipient and times, never its sender or text.
Budget no more than three Instagram accounts per device and scale horizontally by
adding devices.
The workflow records exact post URLs in the notification ledger, and a
database trigger adds each post to `public.ingestion_items`, the only ingestion queue.
The repository and its Actions logs are public: the workflow's binary processes only `post` and `subscription_daily_digest` notifications, its `route` job hands an `instagram_interaction` dispatch to the notification agent's job and ends every other category (the phones' direct messages included) with a notice naming only the category, and a notification payload (a message's text, a sender's name) never enters an `env:` block, a run name, a log line or an artifact.
The Mac's always-on processor reads each queued post logged out, with no account,
cookie or session ID, then owns extraction and database writes.
The processor is Rust (`rust/src/ingestion`, binary `wat2do-ingest`); its LaunchAgent `io.wat2do.ingestion.process` runs `cargo run --release` against the runtime checkout, so a kickstart builds and runs that checkout's code; its prompts are read from the local prompts folder on every agent run (see Agent prompts below), so a prompt edit needs no kickstart.
It runs a Claude Haiku agent that follows `ingestion/prompt.md` and writes only events, event dates and positions through the scoped `wat2do_ingest_agent` login.
The agent draws each event's `title_svg` from its poster by the rules in `ingestion/title_svg_rules.md`.
Each production `wat2do-api` server keeps featured events' drawings complete (`rust/src/ingestion/title_svgs.rs` `run`, with the Mac's Claude Code): every featured event to come (one Wat2Do posted in a carousel or one whose club is claimed, unless its club opted out of carousels or it is not promotable, the events feed's featured row; `featured_events!` in `rust/src/api/events/store.rs`) whose drawing is missing, does not spell its title, or would render badly on a card is drawn again, up to `controlbox/ingestion.json` `title_svg_attempts` times, then after `title_svg_retry_hours`; events that are not featured are never drawn again.
A drawing renders badly (`rust/src/ingestion/title_svg_rendering.rs`, laid out by usvg with the Mac's fonts) when its lettering runs past its view box, a line has no font size or is stretched or squeezed far from its natural width, or dark letters have no light outline; the worker draws again any featured event whose ingestion drawing fails it.
When Claude's usage limit turns an agent away (HTTP 429), or `controlbox/ingestion.json` `agent_failure_streak` agent runs fail in a row, the row goes back without spending an attempt and every agent waits until the reset Claude names, or for `agent_pause_seconds`, so an outage never fails the queue.
Every other Claude caller also treats the limit (`claude::Limited`, Python's `ClaudeLimited`) as no answer at all: a directory run stops and the next run starts over, every sitting waits `controlbox/instagram_sessions.json` `limit_pause_minutes` and stays due, a carousel's song keeps waiting, and unscored follow candidates wait for the next run.
The same processor reads, logged out and one at a time (`controlbox/ingestion.json` `club_logo_read_delay_seconds` apart), the Instagram profile of each club that has a handle but still needs a logo (rendered by Lightpanda at `controlbox/ingestion.json` `profile_renderer`, since Instagram no longer serves profile embeds) or still carries a placeholder "@handle" name, copies its picture into media storage as the club's logo, and replaces the placeholder name with the account's real one.
Handles never read go first, newest club first, and the list is rebuilt every `club_logo_relist_minutes`, so a club that is new or just got a handle is read the same day.
A handle is read again only after `club_logo_retry_days`, or after `club_logo_failed_retry_hours` when Lightpanda did not render its page.
A page that shows no profile counts as Instagram's login wall only when a control profile (`instagram`) does not render right after it; otherwise that handle alone has no public profile and waits its retry days.
A refused read pauses these reads with the post fetches and puts that handle back first in line, due as before.
Instagram does not push every school its posts every day (TMU got no post or digest notification on 2026-11-15, with eleven other schools), so the same processor also reads quiet schools itself (`rust/src/ingestion/quiet_schools.rs`): a school with no `post` or `subscription_daily_digest` notification for `quiet_school_hours`, or no digest for `quiet_school_digest_hours` (bell pushes carry one post each, so they alone don't keep a school covered), has its active followed clubs (an event within `quiet_school_active_days`, or followed within `quiet_school_new_follow_days`) rendered logged out the same way, `quiet_school_lanes` at a time, `quiet_school_read_delay_seconds` apart, schools taking turns, and each post from the last `quiet_school_post_days` days joins `public.ingestion_items` like a notified post.
A handle is read again only after `quiet_school_reread_hours`, the list of clubs to read is rebuilt every `quiet_school_relist_minutes` so a school that just went quiet is read right away, and a refused read pauses these reads with the post fetches and puts that club back first in line.
Haiku directory agents, not code-based parsers, read the official school directories and queue finished event details; the same binary runs them (`wat2do-ingest scrape-directories`, LaunchAgent `io.wat2do.ingestion.directories`, installed with the processor by `wat2do-ingest install-schedule`).
The same run then has Haiku club directory agents read each school's official club directory (`controlbox/ingestion.json` `club_directories`, `ingestion/club_directory_prompt.md`, `rust/src/ingestion/club_directories.rs`), one agent per listing page every `club_directory_scan_days`, each reporting the clubs on its page with the Instagram account the page shows or else the club's own page on the directory.
Code keeps only accounts the listing page shows and pages on the directory's own site, then reads up to `club_directory_pages_per_run` club pages a run, spaced out, each again only after `club_directory_recheck_days`, and takes the Instagram accounts a page links that the site's home page does not.
Every such account its school has no follow candidate row for, and no club names, is queued for following as a pending `directory` row; which pages it read and when stay in `club-directories.json` in the ingestion state directory.
wat2do lists only student-led clubs, events and positions (clubs, societies, student unions and governments, student media and groups) plus varsity teams and their games.
Anything the university itself runs (departments, faculties, offices, services, centres, libraries, alumni, admissions, the university's own accounts) is never listed or followed: the directory prompt, the ingestion prompt and the follow scoring prompt each leave it out.
The one exception is the schools in `controlbox/ingestion.json` `university_event_schools` (OCAD University, whose clubs post too few events): there the university's own events students can attend are listed and its accounts followed too, through each prompt's `{{lists_university_events}}`.
Businesses are never listed either, except the partners in `controlbox/partners.json` (Dip & Drink at TMU, from 2026-11-21): the ingestion prompt lists their events (never their positions) at their schools through `{{partner_accounts}}`, attributed to the partner's handle.
While a partner's event at a school is on or starts within `banner_lead_days`, that school's browse pages show it in the site banner's strip in place of the global banner, with the partner's discount code, its name and the call to action linking to the partner's Instagram post about the event (the event's page here when it has none), until it ends (`frontend/src/features/events/lib/partnerEventBanner.ts`, read from the school's cached events feed).
Partner banners are data only: a person adds a partner to `partners.json`, and no agent ever writes code or settings for a post, since the ingestion agent reads untrusted Instagram posts (Tony, 2026-11-21).
The earlier fixed pipeline (`services/scraper/pipeline.py`, `reconciler.py`, candidate matching in `dedup.py`, and the event and position writers) is vestigial and kept on purpose; do not delete it.

When Instagram collapses a notification into "account posted and N others", the
`process-post` job may expand that notification's CacheEntID through one
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
Each account's password is entered at most once a day and `account_login_daily_limit` a day in all, whether it is added or logged back in after a logout, and a missing account's login starts only `account_login_spacing_seconds` after the last password went out; a login is recorded just before its password goes out, so a failure before that spends nothing.
Once a password has been submitted, a refusal, a challenge, a code that never came or a second login in a row that did not finish holds only that account (a first login that only did not finish is tried once more after its daily limit, since Instagram often finished it anyway) (its jobs fail as unavailable, `accounts_paused` in `wat2do-browser status`) until `wat2do-browser resume-account --account <name>`, and every other school keeps running; after a logout, the next recovery attempt tries the other saved profiles, so browser work never waits for a person while any saved profile can get back in.
Passwords go to the page through osascript's stdin, never a command line, log or file.
A refused password or any other challenge holds that account for a person.
A digest whose account is missing and cannot log in yet marks it missing (`accounts_missing` in `wat2do-browser status`) until its login is allowed again or a digest finds it in Brave.
`io.wat2do.notification-retry` reruns failed "Handle notification" runs: no post run while the worker is paused or down, never one whose account is held or missing (the notification agent's runs, named "Handle <category> - <account>", never use Brave and are reran whatever its state), each run at most `max_reruns_per_run` times, `rerun_spacing_minutes` apart, and at most `reruns_per_pass` a pass, since each rerun switches Brave's account and a burst of switches gets the whole session logged out.
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
One Mac LaunchAgent (`backend/jobs/run_instagram_worker.py`, `io.wat2do.instagram.worker`) is the only thing that drives the emulator (`backend/services/instagram_worker.py`).
It visits one school account at a time: it picks the account with the most urgent work (a sitting that is due, then follows), switches the app to it once, and does everything that account needs before moving on.
A sitting is one school account's whole Instagram turn, done by a Claude session (`backend/services/instagram_sessions/sitting.py`, Tony's decision on 2026-11-21 after carousels waited hours for their likes and songs between the old 9:35 publish job and the worker).
From `controlbox/instagram_sessions.json` `start_hour`:`start_minute` every school account gets one sitting a day, schools with a carousel ready to post first; a carousel posted outside a sitting (the admin's Publish button) that still waits for its like and song brings its school's sitting forward, retried `music_retry_minutes` after a failed try.
The worker holds the emulator on the account for the whole sitting and runs Claude Code (`instagram_sessions/prompt.md`, `controlbox/instagram_sessions.json` `model`, on the second Claude login in `claude_config_dir` so a sitting never spends the login ingestion runs on, at most `sitting_timeout_minutes`) with one tool: the `ig` command (`moves.py`), whose moves run as the worker's children under its hold (`WAT2DO_EMULATOR_HELD`).
In one go the sitting posts the day's draft (`ig post`, which runs `wat2do-instagram publish-draft <school>`), likes, reposts, comments on, tags and sets the song of the post right away (`ig finish`), shares its events' original posts to the story (`ig stories`), then sends the claim-link follow-ups that are due (below); it answers no direct message.
Every move logs when it started and ended and how it went to `~/.local/state/wat2do/instagram-sittings/<date>.jsonl`, never a message's text, and each sitting's report goes to the same file, so every step of every post can be traced afterwards.
A sitting that breaks off (Claude Code fails or times out) is tried again, at most `sitting_attempts` sittings a day.
Sittings happen only between `controlbox/instagram_emulator.json` `action_start_hour` and `action_end_hour`.
One failing step never stops the visit's other steps.
The worker never touches Brave.
It runs in the official Instagram app on the Mac's Android emulator
(`controlbox/instagram_emulator.json`), because Instagram's website cannot add another
account's post to a story and the app is the one place that can do every step.
The emulator holds every school account, logged in once outside this automation and
spread across Android users because the app keeps at most ten accounts each.
A hidden school (`schools.hidden`, today only `testu`, the notification agent's end-to-end test school) is left out of the campus picker, its subdomain, the sitemap, carousel drafts and quiet-school reads.
Its test account sits in `controlbox/instagram_emulator.json` `hidden_school_accounts`, never in `android_user_by_school`, so the notification recorder starts its Android user and names its notifications while no worker visit, sitting or follow crawl ever reaches it.
A switcher row whose name Instagram lost (it reads only its activity, "1 chat and 22 more") is tapped, and the inbox title confirms which account it was; a switch the app answered that never reached the account only rests that account, and never restarts the emulator.
A switch that fails with the Android user on Instagram's challenge page (`ChallengeActivity`, a checkpoint such as "Your email may not be secure" over the account the app is on, back on every app start) also only rests the account: only a person can clear it, and a restart cannot (2026-11-27: wat2do.uwindsor's checkpoint restarted the emulator three times in 80 minutes).
A switch that fails while Android is still starting (its first user not yet running unlocked, which can take minutes after `sys.boot_completed` on a busy Mac) only waits: it neither rests the account nor counts toward a restart, and a restart waits for the same before the worker goes on; failed switches restart the emulator only once Android has been up `restart_min_uptime_seconds`, since for a while after a boot Android's own process can stop answering for minutes and a restart only starts that over (2026-11-23: after the Mac restarted, the emulator restarted every 5 to 15 minutes for three hours).
Instagram's "You've been logged out of <account>" dialog, which covers the app until answered, is acknowledged with OK and logged, so the Android user's other accounts go on; the logged-out account needs a person to log in again.
The notification agent answers direct messages, message requests, story mentions and comments as they arrive (Tony's design, 2026-11-25): the workflow's `handle` job runs on the Mac's own emulator runner (label `wat2do-macmini-emulator`, one run at a time, so a burst queues on GitHub instead of fighting over the phone; a concurrency group would cancel all but the newest waiting run), from the runtime checkout, `backend/jobs/handle_instagram_notification.py run` with the dispatch on stdin.
It (`backend/services/instagram_sessions/notification.py`) waits its turn for the emulator's lock (unfollows and follows stop between profiles for it), switches the app to the account and runs Claude Code on its prompt, read afresh each run from the Mac's local `~/wat2do-data/prompts/instagram_sessions/notification_prompt.md` (prompts never live in the repository; the sittings' model and second login, at most `controlbox/instagram_sessions.json` `notification_timeout_minutes`) with the same `ig` command, and prints only the case and the moves made; the full report, reply included, stays in `~/.local/state/wat2do/notification-agent/<date>.jsonl` on the Mac.
`controlbox/instagram_dms.json` `agent_enabled` is its kill switch (false makes every run a no-op), and while `agent_schools` names any school only those accounts are handled.
A French-language school's account (`schools.language` `fr`) never sends a DM (Tony, 2026-11-26): its notification runs are skipped even when `agent_schools` lists it, `ig reply` and `ig claim` refuse with "no DMs on French schools", `ig inbox` never marks its threads `claim_due`, and `ThreadReader.send_reply` and `send_claim` (`direct.refuse_dms`) refuse before opening the thread.
`ig inbox` lists the main inbox and message requests (an inbox without tabs has a "Requests (N)" link, and opening requests first puts off Instagram's privacy prompt with "Not now"), and `ig read` opens a thread by tapping its row and reads who sent each message, its text and any shared post from the screen the app draws.
A request notification names its sender by display name while the request list shows only usernames, so a thread not found by name is looked for among the requests by the name in each one's prompt ("Accept message request from <display name>"; a request's header shows only the username, which then names the thread once accepted; the sender is not told a request was opened); a waiting request gets no further notifications until it is accepted.
A thread too old for the inbox's scrolls is opened from the inbox's search, tapping only a chat listed above its "More accounts" suggestions.
A shared post's link is copied and read back through the thread's composer, and only the pasted link is deleted again.
Claude decides each thread from the facts about Wat2Do its prompt lists, and only for what any student at the school could attend or use, with broad appeal for a carousel: boosting a post or reel they shared (`ig boost`: like, repost, an upcoming carousel and our story), featuring it in an upcoming carousel (`ig feature`), correcting a listing (`ig correction`), leaving a club that asks out (`ig opt-out`, then `ig mute`, which turns off our notifications of its posts, stories and reels), a short reply (`ig reply`), a heart on their newest message (`ig heart`, for thanks and reactions), accepting a real club's or student's request (`ig accept`), or nothing (traps, spam).
Every move opens its thread from the inbox row each time (`ThreadReader.open_thread`) and refuses unless the thread's header names it (2026-11-25: a claim went into the thread an earlier read had left open, UWaterloo ViVA's, a club that had asked to be left out).
A thread whose sender is in `public.instagram_excluded_clubs` (`refuse_if_excluded`), or whose messages ask us to stop, take something down, ask first or not track them (`asks_to_be_left_out`), gets nothing from any move but the opt-out and its one acknowledgement.
A reply goes only while their newest message is newer than ours (one reply per message of theirs, so a follow-up question the same day is answered), at most `replies_per_thread_per_day` in one thread a day; a thread gets one heart within `thread_repeat_hours`, a post is boosted once, and each account does at most `replies_per_account_per_day`, `boosts_per_account_per_day` and `hearts_per_account_per_day` of them a day; every move others can see waits a random `send_wait_min_seconds` to `send_wait_max_seconds` first and types one character at a time.
A reply clears whatever the composer held before (an old draft is never sent), types its text and taps Send only once the composer shows exactly that text and the header still names the thread.
After every move but a plain look, Instagram's "Confirm you're human", a suspected-automation or "Try again later" notice, an action limit or a login screen stops the move and rests the account's notification handling `challenge_pause_hours` (`notification.pause`), and no move acts for it meanwhile; no move ever types a code or a password.
A heart is a double tap on their newest message, only when no reaction of ours shows under it, confirmed by the pill appearing; `ig read` attaches each reaction pill to the message above it (`reactions`) instead of reading it as a message.
A run that fails keeps Claude Code's own words about why (`ClaudeCodeError.detail`, never in its message) in the Mac's local report only.
A caption is edited by setting the field's text through the screen reader (`EmulatorDevice.set_text`, `ScreenReader.java`'s "set" request), since `adb shell input text` cannot type emoji; short replies are always typed.
A comment on our post gets a like whatever it says but clear spam, scams, hate or anything aimed at our account (`ig comments`, `ig like-comment`), and a genuine one a pin (`ig pin-comment`); Instagram keeps at most three comments pinned on a post, so a fourth is refused before anything is tapped, and comments are never replied to.
A correction is fixed, not only queued: `ig find-event` lists the sender's club's events from the last week on with the posted carousels each is on, `ig fix-event` changes only what they said was wrong through `update_event_with_occurrences` (the transaction the app's own event edit runs) and refreshes the school's feeds, and only an event of the sender's own club can be changed; `wat2do-instagram refresh-slide <batch> <event>` then draws that carousel slide again with the carousel renderer, keeps it as the slide's image and rebuilds the caption.
`handle_instagram_notification.py dry-run` runs the same prompt over recorded threads with moves that read the recording and only say what they would do.
The claim-link message to a club that asked us to repost, share or feature its post (Tony, 2026-11-24) is only a follow-up, sent by the daily sitting: at least `controlbox/instagram_dms.json` `claim_follow_up_hours` after we boosted, shared or featured that post (from the sitting logs), with our message still the newest in the thread and no claim link ever sent there, never alongside the reply to the request (Tony, 2026-11-25); `ig inbox` marks such threads `claim_due`.
`ig claim "<name>" <their username>` types its club's own claim link (from its outreach lead; one is made if the unclaimed club has none) into the thread at a person's pace, confirms it in the composer and sends it, saying we will keep featuring their events and asking them to claim their club; the link is never printed or logged. A claim-link draft left waiting is sent as it is only when its token is one of that club's own, a thread holding any other unsent text is left alone, and each account sends at most `controlbox/instagram_dms.json` `claim_sends_per_account_per_day` a day, each a random `claim_send_gap_min_seconds` to `claim_send_gap_max_seconds` after its last.
A club gets its claim message once ever (every day's sitting log is checked), and only in its own thread: `ig claim` also needs the thread's sender to be the club's handle, not left out, and checks the header again just before Send.
Every claim link reads as `[claim link]`.
Clubs want story reposts and carousel spots, so replies never ask about adding things
to the site.
A story repost or carousel request sets `events.carousel_requested_at` on the events
listed from the shared post; a post not listed yet is queued in `public.ingestion_items`
with the request, and the ingestion agent marks the events it describes.
Daily carousel drafts always consider requested events, however long ago they were
added, and rank them first.
Wat2Do promotes only events any student at the school can attend and a typical student there would want to go to (Tony, 2026-11-25): no residence, members-only, program, year or identity-group events, and no pre-med, law, career, academic or general-meeting events, even requested ones.
The one statement of that rule is `instagram_publishing/promotion_rules.md`, which the curation prompt renders as a hard rule; a sitting shares to the story only what every student can join or apply to, so recruitment and niche events open to all may go there but never into a carousel.
The ingestion agent's prompt renders the same rules and records each event's verdict as `events.promotable`; `promotable_event!` (`rust/src/api/events/store.rs`) keeps an event judged false, or one whose club opted out, out of carousel candidates and the featured row, and null (never judged: events listed before 2026-11-25, and submitted ones) counts as promotable.
Right after curation saves a draft, the draft audit (`rust/src/instagram_publishing/audit.rs`, the local prompt `instagram_publishing/draft_audit_prompt.md`, `controlbox/instagram_publishing.json` `draft_audit_model`) has a second agent judge every slide by the same rules (plus no religion or politics); a slide that fails leaves the draft through the admin editor's own save (`batches::update_batch`) before a sitting can post it, its event is marked not promotable, and each audit is appended to `~/.local/state/wat2do/instagram-carousels/draft-audits.jsonl`.
`wat2do-instagram quality-test` runs the live curation prompt and the draft audit several times over a fixed packet (`rust/src/instagram_publishing/testdata/curation_quality.json`: banned, great and ordinary events) and writes a pass or fail per event and per check to `~/Desktop/carousel-quality-test.html`; rerun it after every change to the curation or audit prompt or the promotion rules.
The audit and the quality test run on `quality_claude_config_dir`, never the Claude login ingestion runs on.
A carousel shows at most `controlbox/instagram_publishing.json` `maximum_slides_per_post` events read from one Instagram post (the curation agent sees each event's `source_post`, and code refuses an answer over the cap so the agent picks again): one club post listing a week of events filled Berkeley's 2026-11-18 carousel 7 of 8.
A correction queues the club's words as a `dm` row in `public.ingestion_items`, and the
ingestion agent corrects only the listings it clearly refers to.
An opt-out adds the sender to `public.instagram_excluded_clubs`.
A story request is shared first and its reply sent after.
The emulator finds every control by its accessibility label, taps at a random point
inside it after a random pause, types one character at a time, and never types a
password.
It reads each screen through `ScreenReader.java` (`backend/services/instagram_emulator`), `uiautomator dump` kept running while the emulator is held, rebuilt into the committed `screen-reader.jar` by `scripts/build_emulator_jars.py`, which builds the notification recorder's `notification-reader.jar` too.
Each message is confirmed by seeing it in the thread's composer before Send, and `ig tap` can never tap Send.
The emulator also likes, reposts and adds music to our own carousels right after the API
posts them, since the API can do none of these: the sitting's `ig finish` opens the live post, likes it, reposts it unless the Repost icon already shows its check mark, then
Edit, Add audio,
searches the admin's song list in the day's rotation order, and Claude Haiku picks the matching
track or none (`services/instagram_publishing/music.py` `finish`).
The same edit tags the post with the school's own place: the first one Instagram's location search lists under the school's exact name (`schools.name`), else the one Claude Haiku recognizes as the school, or none; a place that cannot be tagged never holds up the song.
It also tags each event slide with its event's club (`events.ig_handle`, never our own accounts) through Tag people: the tagging screen is turned one slide at a time (cover first) and each turn is confirmed by the picture changing, the user search's row with the exact handle is tapped, and a club that lets only accounts it follows tag it ("Can't tag") is left untagged; a post that already has tags is left as it is.
While a carousel is at most `story_max_age_hours` old and its `story_status` is pending, the sitting's `ig stories` then shares each event's original Instagram post to the account's story, in slide order, the way a DM's story request is shared, so the story opens the club's own post (`services/instagram_publishing/stories.py` `share`). Each of those stories gets a blue "Featured" sticker (French "En vedette") on the post's top-right corner: `put_photo` makes `services/instagram_emulator/assets/featured_sticker_<language>.png` the gallery's newest photo (under a new name each time, deleting its earlier copies, since Android keeps an overwritten picture's place and the other language's sticker stayed first: 2026-11-23, English schools sharing an Android user with French ones got "En vedette"), the story editor adds it as a photo sticker and `drag` moves it (`story._place_sticker`); the PNGs come from `frontend/scripts/render-featured-story-sticker.mjs`. DM story reposts get no sticker.
The editor moves a sticker only from the first finger move past Android's touch slop, and takes a finger still inside the slop when the next `input` command starts for a long press that moves nothing, so every `drag` leads off well past the slop and lifts as far past its target, and a sticker left short of the corner (a drag towards the screen's right edge can stop early) is dragged again from where it stopped, up to six drags (2026-11-21: every correction stayed put, and nearly every story failed).
Each post is tried once and the story is marked before the first share, so it is never shared twice; a post that cannot be shared is left out, and why, post by post, goes into `story_error` ("2 of 3 posts shared. Not shared: <post> <reason>"), shown in the admin's carousel drawer, and into the `ig stories` answer the sitting log keeps.
Every sitting then thanks its followers at a milestone: `ig milestones` (`services/instagram_publishing/milestones.py` `report`) shows Claude the account's follower count at each daily stats run of the last two weeks (`instagram_account_snapshots`), its like record from its newest posts (`instagram_account_media`) and what was already celebrated, and lists as open the milestones code allows; Claude decides from the history whether the account really just hit one (Tony, 2026-11-25) and posts it with `ig milestone-story --followers <N>` or `--likes <post>`, which refuses anything not open.
Code makes a double or stale story impossible: `public.instagram_account_milestones` keeps what each check saw, a milestone opens only when this check sees it happen since the last one (the count went from under a clean hundred to at or over it, or a post beat the like record by reaching at least `controlbox/instagram_sessions.json` `milestone_minimum_likes`), an account's first check only records where it stands, a jump over several hundreds opens only the newest, a hundred at or under the highest celebrated never opens again (a dip and recovery), a check over `milestone_window_hours` after the last one or reading a stats run that old opens nothing (the crossing may be days old), a story is taken only in the sitting whose check opened it (`sitting_timeout_minutes`), and the milestone is closed as celebrated just before "Your story" is tapped.
The story is a screenshot taken on the emulator, of the account's own profile (Instagram's "Discover people" suggestions closed) or of the record post once its picture has loaded, on a Wat2Do-blue card under a short lowercase line of thanks in the school's language, with no emoji, shared to the story from the gallery (`story.share_photo`: Android's share to Instagram's story editor).
A song the admin marks as Asian or K-pop is tried only at the campuses in
`controlbox/instagram_publishing.json` `asian_song_schools`.
While `asian_song_override` there lists any songs, those campuses play only those songs instead (since 2026-11-25, only The Weeknd's "Hong Kong"); emptying the list goes back to the songs marked Asian or K-pop.
The emulator also follows the clubs each school account should follow, and the follow crawl finds them through the browser worker.
`public.instagram_follow_candidates` is the one queue of accounts to follow: any feature that wants an account followed adds a row there with its `source` (`crawl`, `club`, `import` or `directory`), and nothing else follows accounts.
One row per school and handle is kept whatever its status, so an account an admin rejected is never offered again.
Every listed club's Instagram account goes in pending for its school, linked to its club (`sync_club_targets`), so the scorer checks it belongs to the school like any crawled account.
Rejecting an account the school may still follow (its row is followed, a follow was tapped, or the school's own Following list showed it since any unfollow) queues an unfollow instead, whoever rejects it (the scorer, an admin, a script): a database trigger (`follow_candidate_unfollow_on_reject`) turns that rejection into `unfollow`, and deleting a club rejects its account's row the same way (`reject_deleted_club_follow`).
An unfollow counts once Instagram confirms it, or once two looks `follow_retry_hours` apart both find no follow to undo (the profile shows Follow, or is gone or hidden, as a renamed account is under its old handle).
Accounts a school's official club directory lists come from the club directory agents as pending `directory` rows whose `found_via` names the directory, and the scorer decides them like crawled ones, told which directory lists each; one found for a club of ours without an account is linked to that club, so approving it gives that club the account instead of making a second club.
Crawling (`backend/services/instagram_follow/crawl.py`) never stops: crawls under way go first and take turns a read at a time (one whose read still waits keeps its place, then the one that queued a read longest ago), so with fewer Following readers than running crawls every one of them keeps moving; then schools never crawled, then the school whose last crawl finished longest ago, so a school whose crawl ends is crawled again once the schools that finished before it have had their turn.
It reads Following lists only through the browser worker's `following` jobs (`wat2do-browser following`, collected with `status --job-id`, checked less often the longer a read waits), keeping one read outstanding per school and crawling as many schools at once as the worker has Following readers (`status` `following.readers`), and runs in its own thread of the emulator worker's process, restarted if it ever stops, without ever touching the emulator.
Every crawl starts over from the school account's own Following list (read by its `recipient_id`, to its end): every public account the school follows is a seed, and each seed's whole Following list is read in turn, at most `crawl_list_page_limit` pages deep.
What that list shows is recorded (`candidates.record_following`, `seen_following_at`): a rejected account it still shows is unfollowed, and a public account it shows with no row goes to the scorer, so an account we follow by mistake is found even with no row; the list proves only what it shows, so an account it misses is never taken as unfollowed, and the school's partners (`controlbox/partners.json`) are left alone.
A public account the school does not follow and has no row for becomes a pending candidate when its handle or name carries one of the school's names in `controlbox/instagram_follow.json` `school_names` as a word (UofT's campuses list each other; only the slug and names of six letters or more may start or end a run-together word, so "mac" or "queen" never matches inside one), or once `crawl_mutual_follow_threshold` of the school's followed clubs follow it; `found_via` names those clubs.
Sightings below the threshold are kept across crawls in local state (`sightings.sqlite3`), so the count grows crawl after crawl, and one no crawl sees again for `crawl_sighting_retention_days` is forgotten; a private account is never a candidate, since it is almost always a member and the scorer cannot read it.
The crawl stops only once `crawl_miss_streak` seeds in a row add no new candidate, or no seed is left; a page that fails to read is read again, up to `crawl_seed_attempts` times, and never counts as a miss, a hold or pause in Brave only keeps the crawl waiting, and a read still waiting after `crawl_read_timeout_seconds` while Brave holds nothing rests that school's crawl (its read is still collected) so the others go on.
Each crawl takes the school's seeds in a new random order, so a crawl the miss streak ends early still reaches clubs the last one never did, and crawl after crawl covers them all.
Its place is kept in local state, so a restart picks up at the page it was reading; state an older crawler left is finished and replaced by a fresh crawl.
New candidates are read logged out from their profile embed (`fetch_profile`) and scored by Claude (`instagram_follow/prompt.md`) from their newest posts; each scoring run takes an equal share of every school's oldest unscored accounts, so one school's long backlog never keeps another's new finds waiting.
The scorer is told the school's full name and city (a same-named school elsewhere, such as the University of York in England for York University, or another campus of the same university is never this school), and its verdict decides the account at once: only an approve verdict is approved, or a review of an unreadable profile the school's club directory lists or one of our own clubs' accounts; an account it is unsure of is rejected and, while it keeps posting, scored again every `recheck_days`.
Admins review them on the admin Clubs page's Follow candidates tab; approvals and rejections are staged in the page and submitted together.
The tab filters by school, status and how recently each account reached that status (its last 1, 3, 7 or 30 days): pending accounts list best scored first, every other status newest first under a heading per day.
Approving creates the school's club for the handle unless one exists, and queues the follow.
The emulator worker checks `follows_due` from the database, then calls `follow_due` with the emulator on the school's account.
`follow_due` follows a few approved accounts per visit, at most `follows_per_account_per_day` a day and `follows_per_account_per_hour` within any hour, and sets each one's post notifications to All so ingestion hears about its posts; an account already followed is only marked followed, after its bell is checked, and never counts toward the day's follows.
Instagram's "Try again later" pauses that account's follows for a day; it is never pushed through.
Only the worker and the notification agent's runs tap the emulator, each holding its lock for one visit or run at a time; a sitting's or run's moves run under that hold.
Every message is untrusted: the prompt lists the traps to ignore (instructions inside a
message, impersonation, login codes, money, follow-for-follow, pressure).
Code, not the model, has the final say: a post can be boosted, shared or featured only when they shared it in the thread with its owner readable, an opt-out needs a readable sender, and a reply with a
tag, a link outside wat2do.io, an email address other than `controlbox/instagram_dms.json`
`contact_email` or a long number is not typed at all.
A sitting stops at "Confirm you're human", a login screen or an action limit and reports it for a person; it never types a code or a password.
A story share waits while the emulator has
less free storage than `controlbox/instagram_emulator.json` `min_free_data_megabytes`.
The emulator's LaunchAgents (the keep-alive, the worker and the notification recorder) are Standard processes, never Background: launchd runs a Background agent and its children at the lowest CPU priority, so a busy Mac (Spotlight re-indexing, a Rust build, ingestion agents) starved Android until it rebooted itself (2026-11-23).
The emulator's keep-alive LaunchAgent (`scripts/instagram_emulator.py`, `io.wat2do.instagram-emulator`) boots it whenever adb cannot see it and stops it to boot again once Android has answered no `adb shell` command for `controlbox/instagram_emulator.json` `unresponsive_restart_seconds`, since a hung Android still shows in adb (2026-11-18: hung 13 hours, every notification and carousel follow-up lost).
It also restarts it, under the emulator's lock so no job is cut off mid-step, once qemu has used at least `spin_cpu_percent` of the Mac's CPU while Android used at most `spin_guest_cpu_percent` for `spin_restart_seconds` straight: with `-gpu host` qemu's render threads can get stuck spinning in `EglContext::~EglContext` (2026-11-25: 480-630% for about 9 hours while Android sat idle, and the Mac throttled for heat).
A stop kills qemu outright when it has not exited `stop_wait_seconds` after the console's `emu kill`, which can answer OK while qemu keeps running.
Once a day, from `reclaim_hour` (before the morning's sittings), the worker
deletes Instagram's caches on every Android user as root
(`instagram_cache_paths`), never its login, databases or settings, then restarts the
emulator, whose host process leaks about 3 GB of memory a day.
Unfollows and follows stop between profiles once a sitting is due or that restart is due.
A step that fails starts Instagram afresh on that Android user, so nothing it left open covers the next step, and `failures_before_rest` profiles failing in a row rest that account's follows (as that many failed Following reads in a row rest that school's crawl).
Both stop Instagram with `am force-stop`, which also leaves an app in Android's stopped state, getting nothing in the background until it is opened again, so `pm unstop` follows every one; the reclaim never clears another app's data (clearing Google Play services dropped the Android users' device registration).
Never log DM text.

If serialized browser expansion cannot complete, fail before recording that
notification's media so the workflow can be rerun safely.
Other notification workflow runs must remain independently processable.

Secrets and Instagram credentials must still follow the repository's existing
secret-storage rules and must never be committed.

### Agent prompts

Every agent prompt (each `*_prompt.md`, `prompt.md`, rules file such as `ingestion/title_svg_rules.md` and `instagram_publishing/promotion_rules.md`, `outreach/hooks.md` and `scraper/extraction_prompt.txt`) lives only on the Mac, in `~/wat2do-data/prompts`, never in this repository (Tony, 2026-11-25).
The repository is public, so keeping prompts out of it also keeps them private.
Prompt names above (such as `ingestion/prompt.md`) are paths inside that folder.
Every run reads its prompt from there when it starts (`rust/src/prompts.rs`, Python's `core/prompts.py`, the folder from `WAT2DO_PROMPTS_DIR`, by default `~/wat2do-data/prompts`), so editing a file in place applies on the very next run, with no build, kickstart, push or deploy; a missing file fails that run loudly instead of falling back to an old copy.
The folder is its own local git repository, never pushed anywhere, and the LaunchAgent `io.wat2do.prompts-autocommit` commits every change within a minute, so `git log -p <file>` there shows each edit and any edit can be undone.
A new agent prompt goes in that folder too, never in the repository, and its code reads it through those loaders.
Tests never see the folder: they read stand-ins with the same placeholders from `backend/tests/fixtures/prompts`, and `backend/tests/core/test_prompts.py` checks on the Mac that every stand-in's prompt exists there with the same placeholders, so add or update the stand-in in the same change as the code that fills a prompt.

### Mac maintenance

Nobody watches the Mac by hand (Tony, 2026-11-26, after Instagram post collection went quiet for 18 hours unnoticed), so two LaunchAgents keep it healthy, both installed by `backend/jobs/maintain_wat2do.py install-schedule` and tuned in `controlbox/maintenance.json`.
The hourly watchdog (`maintain_wat2do.py watchdog`, LaunchAgent `io.wat2do.maintenance.watchdog`, no Claude) reads hard numbers and judges them in `backend/services/maintenance/judges.py`: Instagram items per window and per day against the same hours of the last `baseline_days` (collection is strongly diurnal, with evening digest bursts), each school against its own median (red when nearly dark, or when it had no daily digest for `school_digest_hours` and the quiet-school lane is not making up for it), the Brave worker (pause, heartbeat, failed digests, ERROR lines in `worker.stderr.log`), the ingestion processor (running, Claude usage-limit lines), the notification recorder (silence outside Toronto nights, which are quiet until `recorder_quiet_until_hour`, silence per Android user, daily digests, waiting dispatches), the "Handle notification" runs (failure rate, stuck queued runs) and the notification agent's own reports, the runners, the emulator (adb, logins read from each Android user's `user_access_map`, restarts, qemu CPU), disk and swap, every LaunchAgent in `keep_alive_agents` and `scheduled_agents` and the retry agent, today's sittings and carousels, the Graph tokens, and a one-word probe of both Claude logins.
Every pass appends its checks to `~/.local/state/wat2do/maintenance/watchdog.jsonl`; production reads follow the read-only rules below.
A red check starts the maintenance agent at once (`launchctl kickstart` of `io.wat2do.maintenance.agent`, with the problems in `trigger.json`), each check at most once per `trigger_debounce_hours` and at most `triggered_runs_per_day` early runs a day; a check only a person can clear (a Graph token) never starts it early.
The maintenance agent (`maintain_wat2do.py agent`, LaunchAgent `io.wat2do.maintenance.agent`) runs every day at `agent_hour`:`agent_minute` whatever the watchdog saw, plus those early runs: Claude Code (`model`, on the second login in `claude_config_dir`, never the one ingestion uses) gets the watchdog's numbers and its prompt, `maintenance/prompt.md` in the local prompts folder, checks every school's logins on the emulator and in Brave, that notifications are recorded, dispatched and handled, that collection, ingestion, carousels and stories are flowing, fixes what the memory recipes cover, and writes `~/Desktop/wat2do-reports/health-<date>.html`, with only what truly needs Tony's hands at its top.
`agent --dry-run` changes nothing and writes `health-<date>-dry-run.html`; every run's answer is appended to `agent.jsonl` beside the watchdog log, and a run Claude could not finish still writes the report from the watchdog's numbers.

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
The admin's carousel routes are Rust (`rust/src/api/routes/instagram_publishing`), and so are the carousel jobs (`rust/src/instagram_publishing`, binary `wat2do-instagram`): Claude's daily drafts (`curate`, LaunchAgent `io.wat2do.instagram.curate`, installed by `wat2do-instagram install-schedule` and run with `cargo run --release` against the installing checkout), posting one school's ready draft for its sitting (`publish-draft <school>`, run the same way by the sitting's `ig post`), and the daily token refresh and account stats (`stats`, the Mac mini's `io.wat2do.instagram-account-stats` timer, from the deployed release).
A posted carousel's story is left to its sitting: the post marks its `story_status` pending (`controlbox/instagram_publishing.json` `share_event_posts_to_story` turns that off), and the API never posts to stories.
The Publish button claims the batch in Rust, then starts `wat2do-instagram publish-batch <id>`, the binary beside `wat2do-api`, as a detached process from the API's working directory, and a process that cannot start or crashes marks the batch failed.
Liking, reposting, adding music, tagging clubs and sharing the story of a published carousel happen in the sitting's moves on the Python emulator worker (`services/instagram_publishing/music.py`, `stories.py`).
Each `wat2do-api` server also runs the map location worker (`rust/src/map_locations.rs`), which looks up waiting `map_locations` with Nominatim; `claim_map_location` keeps every server to one lookup at a time between them.
Uploads (`/uploads` and the `/ai` poster readers) are checked and stored in Cloudflare R2 (with the thumbnail of each poster and raster club logo) by `rust/src/storage.rs`, and posters are read by OpenAI with `scraper/extraction_prompt.txt`, the template the vestigial Python extractor renders too; Python's `storage_service` remains only for that pipeline and scripts.
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
