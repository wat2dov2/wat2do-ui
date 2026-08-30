# Instagram Automation Commands

The active collection path uses Android Instagram notifications.
When Instagram collapses several posts into one digest, the GitHub processing job expands that notification through one existing Brave Instagram tab before recording notification media.
The resolver switches accounts serially and never extracts or persists browser cookies.

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

## One-time Brave setup for collapsed digests

Keep one logged-in `https://www.instagram.com/` tab open in Brave with the school accounts available under More > Switch accounts.
In Brave, enable View > Developer > Allow JavaScript from Apple Events.
This permission lets the local Python process ask the existing Instagram tab to switch accounts and make the digest request in its own authenticated context.
The Python process receives only the matched username and recovered media IDs.
It never receives `sessionid`, CSRF, or other cookie values.

The resolver does not open Brave and does not log into accounts.
CacheEntID workflows always target the single browser-capable Mac runner and wait when it is offline instead of falling back to Ubuntu.
That runner processes one job at a time, so browser account switching is serialized.
If the tab is closed, the account needs a security challenge, or the matching account is absent from the switcher, the workflow fails before its notification media ledger entry is created and can be rerun safely.

To test one captured digest without dispatching it, run:

```sh
cd backend
python scripts/emulator_farm.py resolve-digest \
  --recipient-id '<intended_recipient_id>' \
  --cache-ent-id '<cache_ent_id>' \
  --instagram-action '<full_instagram_action>' \
  --total-media-count '<total_non_mmc_media_count>'
```

The command prints the matched account, the complete media ID list, page count, and merged Instagram action.
The `process-notification` workflow calls the same resolver automatically when it receives a collapsed digest.
The regular `run-cycle` and `monitor` commands only forward the original Android payload.

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
