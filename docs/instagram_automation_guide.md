# Instagram Automation Commands

Run Keychain-backed commands from an interactive terminal logged in as the same macOS account that owns the self-hosted `wat2do-scraper` runner.
The current runner account is `tonyqiu`.
Confirm that `whoami` matches the owner of the running `Runner.Listener` process before provisioning or inspecting sessions.
macOS Keychain items stored under another account are invisible to GitHub Actions.
Never grant all applications access with `security -A`, and never store the macOS login password in GitHub secrets.

The runner LaunchAgent must use the existing GUI security audit session so background jobs can access the runner owner's unlocked login Keychain.
The generated runner service plist must not contain `SessionCreate=true`, because that creates an isolated security audit session whose Keychain cannot be unlocked without user interaction.

Verify this after installing or reinstalling the runner, and only restart the listener when no `Runner.Worker` process is active:

```sh
set -euo pipefail

runner_label=actions.runner.tonyqiu123-wat2do-ui.wat2do-mac-mini
runner_plist=/Users/tonyqiu/Library/LaunchAgents/actions.runner.tonyqiu123-wat2do-ui.wat2do-mac-mini.plist
runner_domain="gui/$(id -u)"

if /usr/bin/pgrep -f '^/Users/tonyqiu/actions-runner-wat2do/bin/Runner.Worker( |$)' >/dev/null; then
  echo 'Runner.Worker is active; do not restart the runner.' >&2
  exit 1
fi

runner_backup="$(/usr/bin/mktemp /tmp/wat2do-runner-plist.XXXXXX)"
/bin/cp -p "$runner_plist" "$runner_backup"
printf 'Rollback backup: %s\n' "$runner_backup"

/bin/launchctl bootout "$runner_domain/$runner_label"
if /usr/libexec/PlistBuddy -c 'Print :SessionCreate' "$runner_plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c 'Delete :SessionCreate' "$runner_plist"
fi
/usr/bin/plutil -lint "$runner_plist"
/bin/launchctl bootstrap "$runner_domain" "$runner_plist"
/bin/launchctl print "$runner_domain/$runner_label" | /usr/bin/grep 'properties ='
```

The printed properties must not contain `creates session`.
Run the `Instagram digest session health` workflow after this check, because an interactive Keychain read does not exercise the Actions security context.
The standard runner service installer can recreate `SessionCreate=true`, so repeat this verification after every service reinstall.

## Running Multiple Concurrent Runners on Mac mini

A single self-hosted runner instance only executes one job at a time.
To process multiple incoming notifications concurrently, register additional runner instances (e.g. `actions-runner-wat2do-2`) on the same Mac mini.

1. Generate a registration token using the GitHub CLI or repository settings:
```sh
gh api -X POST repos/wat2dov2/wat2do-ui/actions/runners/registration-token --jq .token
```

2. Create a new runner folder, copy binaries from the existing runner, and configure it:
```sh
mkdir -p ~/actions-runner-wat2do-2 && cd ~/actions-runner-wat2do-2
cp -R ~/actions-runner-wat2do/bin ~/actions-runner-wat2do/externals ~/actions-runner-wat2do/config.sh ~/actions-runner-wat2do/run.sh ~/actions-runner-wat2do/env.sh ~/actions-runner-wat2do/svc.sh ./
./config.sh --url https://github.com/wat2dov2/wat2do-ui \
  --token <REGISTRATION_TOKEN> \
  --name wat2do-mac-mini-2 \
  --labels wat2do-scraper,macOS,ARM64 \
  --unattended
```

3. Install the LaunchAgent service and remove `SessionCreate`:
```sh
./svc.sh install
runner_plist=~/Library/LaunchAgents/actions.runner.wat2dov2-wat2do-ui.wat2do-mac-mini-2.plist
if /usr/libexec/PlistBuddy -c 'Print :SessionCreate' "$runner_plist" >/dev/null 2>&1; then
  /usr/libexec/PlistBuddy -c 'Delete :SessionCreate' "$runner_plist"
fi
/usr/bin/plutil -lint "$runner_plist"
/bin/launchctl bootstrap "gui/$(id -u)" "$runner_plist"
```
Repeat for additional slots (`wat2do-mac-mini-3`, etc.) as needed.

# List schools in the spreadsheet
cd backend && python scripts/follow_from_xlsx.py --list-schools

# Store or replace a browser session securely in macOS Keychain
cd backend && python scripts/manage_instagram_digest_sessions.py store <intended-recipient-id>

# Run follow automation using the school's recipient-routed Keychain session
cd backend && python scripts/follow_from_xlsx.py --username <school>.wat2do.io

# Run bell notification automation on emulator (non-headless / normal GUI window)
# First: open Instagram on the emulator and navigate to "All profiles you follow".
# Then run the script - it only walks that list and taps each row's bell.
~/Library/Android/sdk/emulator/emulator -avd $(~/Library/Android/sdk/emulator/emulator -list-avds | head -n 1) -no-audio & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device

# Run GUI emulators
~/Library/Android/sdk/emulator/emulator -avd Pixel_10 -read-only -port 5554 -no-audio & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device && \
python3 /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend/scripts/automate_bell_notifications.py --device emulator-5554


# Confirm both emulator IDs are available
~/Library/Android/sdk/platform-tools/adb devices

# Run bell notification automation on emulator (headless / background, saves CPU/GPU)
# Still requires the "All profiles you follow" screen to already be open on that emulator.
cd /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend && \
~/Library/Android/sdk/emulator/emulator -avd Pixel_10 -read-only -port 5554 -no-window -no-audio > /dev/null 2>&1 & \
sleep 2; \
~/Library/Android/sdk/platform-tools/adb wait-for-device && \
python3 /Users/tonyqiu/Desktop/projects/2026/wat2do-v2/backend/scripts/automate_bell_notifications.py --device emulator-5554

# Stop a specific emulator
~/Library/Android/sdk/platform-tools/adb -s emulator-5554 emu kill 2>/dev/null; pkill -f qemu-system
