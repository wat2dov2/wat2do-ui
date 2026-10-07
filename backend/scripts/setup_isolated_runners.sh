#!/usr/bin/env bash
set -euo pipefail

# Fresh runners receive separate roots and bounded diagnostic retention.
# Existing registrations are preserved; updates belong to the runner updater.
SCRIPT_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTROL_VALUES="$(python3 - "${SCRIPT_DIRECTORY}/../controlbox/runner_setup.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    control = json.load(handle)
print(*(control[key] for key in (
    "runner_count", "runner_version", "download_timeout_seconds",
    "download_connect_timeout_seconds", "download_retry_limit",
    "setup_timeout_seconds", "log_retention_days", "log_page_size_megabytes",
)))
PY
)"
read -r DEFAULT_COUNT DEFAULT_VERSION DOWNLOAD_TIMEOUT CONNECT_TIMEOUT DOWNLOAD_RETRIES SETUP_TIMEOUT LOG_RETENTION LOG_SIZE <<< "$CONTROL_VALUES"

run_bounded() {
  python3 - "$SETUP_TIMEOUT" "$@" <<'PY'
import subprocess
import os
import signal
import sys

def interrupted(_signal, _frame):
    raise KeyboardInterrupt

signal.signal(signal.SIGTERM, interrupted)
process = None
try:
    process = subprocess.Popen(sys.argv[2:], start_new_session=True)
    result = process.wait(timeout=int(sys.argv[1]))
except (OSError, subprocess.SubprocessError, KeyboardInterrupt) as exc:
    if process is not None:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.wait()
    raise SystemExit(f"Runner setup command failed ({type(exc).__name__}); inspect the runner before retrying.") from None
raise SystemExit(result)
PY
}

verify_service() {
  if [[ ! -f .service ]]; then
    echo "Runner service is not installed; run ./svc.sh install from this runner directory." >&2
    return 1
  fi
  SERVICE_LABEL="$(python3 - "$(cat .service)" <<'PY'
import plistlib
import sys

try:
    with open(sys.argv[1], "rb") as handle:
        print(plistlib.load(handle)["Label"])
except (OSError, plistlib.InvalidFileException, KeyError) as exc:
    raise SystemExit(f"Runner service registration is invalid ({type(exc).__name__}); inspect .service and its plist.") from None
PY
)"
  if ! SERVICE_STATE="$(run_bounded launchctl print "gui/$(id -u)/${SERVICE_LABEL}" 2>/dev/null)" || [[ ! "$SERVICE_STATE" =~ state[[:space:]]*=[[:space:]]*running ]]; then
    echo "Runner service is not running; inspect ./svc.sh status and start from this runner directory." >&2
    return 1
  fi
}

REPO_URL="${1:-}"
TOKEN="${2:-}"
NUM_RUNNERS="${3:-$DEFAULT_COUNT}"
RUNNER_VERSION="${4:-$DEFAULT_VERSION}"

if [[ ! "$REPO_URL" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$ || -z "$TOKEN" ]]; then
  echo "Usage: ./backend/scripts/setup_isolated_runners.sh <REPO_URL> <GITHUB_RUNNER_TOKEN> [NUM_RUNNERS] [RUNNER_VERSION]" >&2
  exit 1
fi
if [[ ! "$NUM_RUNNERS" =~ ^[1-9][0-9]*$ || "$NUM_RUNNERS" -gt 10 || ! "$RUNNER_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Runner count must be 1 to 10 and version must be a numeric release version." >&2
  exit 1
fi
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This setup installs macOS LaunchAgents and requires macOS." >&2
  exit 1
fi
case "$(uname -m)" in
  arm64) ARCH="osx-arm64" ;;
  x86_64) ARCH="osx-x64" ;;
  *) echo "Unsupported Mac architecture." >&2; exit 1 ;;
esac

SETUP_LOCK="${HOME}/.wat2do-runner-setup.lock"
if ! mkdir "$SETUP_LOCK" 2>/dev/null; then
  echo "Another runner setup may be active. Inspect ${SETUP_LOCK} before retrying." >&2
  exit 1
fi
STAGING_DIRECTORY=""
cleanup() {
  if [[ -n "$STAGING_DIRECTORY" ]]; then rm -rf "$STAGING_DIRECTORY"; fi
  rmdir "$SETUP_LOCK"
}
trap cleanup EXIT

# Refuse partial or foreign installations before downloading or registering.
NEEDS_SETUP=false
for ((i = 1; i <= NUM_RUNNERS; i++)); do
  RUNNER_DIR="${HOME}/actions-runner-${i}"
  if [[ -f "${RUNNER_DIR}/.runner" ]]; then
    (cd "$RUNNER_DIR" && verify_service)
    echo "Keeping configured runner ${RUNNER_DIR}."
  elif [[ -e "$RUNNER_DIR" && -n "$(ls -A "$RUNNER_DIR")" ]]; then
    echo "Unconfigured nonempty runner directory: ${RUNNER_DIR}. Inspect it before retrying." >&2
    exit 1
  else
    NEEDS_SETUP=true
  fi
done
if [[ "$NEEDS_SETUP" == false ]]; then
  echo "All requested runners are already configured."
  exit 0
fi

STAGING_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/wat2do-runner-setup.XXXXXX")"
TARBALL_NAME="actions-runner-${ARCH}-${RUNNER_VERSION}.tar.gz"
RELEASE_URL="https://api.github.com/repos/actions/runner/releases/tags/v${RUNNER_VERSION}"
DOWNLOAD_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL_NAME}"
CURL_OPTIONS=(--fail --silent --show-error --location --retry "$DOWNLOAD_RETRIES" --retry-max-time "$DOWNLOAD_TIMEOUT" --connect-timeout "$CONNECT_TIMEOUT" --max-time "$DOWNLOAD_TIMEOUT")

curl "${CURL_OPTIONS[@]}" -o "${STAGING_DIRECTORY}/release.json" "$RELEASE_URL"
EXPECTED_SHA="$(python3 - "${STAGING_DIRECTORY}/release.json" "$ARCH" <<'PY'
import json
import re
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    release = json.load(handle)
match = re.search(r"<!-- BEGIN SHA " + re.escape(sys.argv[2]) + r" -->\s*([0-9a-f]{64})", release["body"])
if match is None:
    raise SystemExit("The official runner release did not provide an archive checksum.")
print(match.group(1))
PY
)"
curl "${CURL_OPTIONS[@]}" -o "${STAGING_DIRECTORY}/${TARBALL_NAME}" "$DOWNLOAD_URL"
ACTUAL_SHA="$(shasum -a 256 "${STAGING_DIRECTORY}/${TARBALL_NAME}" | awk '{print $1}')"
if [[ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Runner archive checksum mismatch. No runner registration was changed." >&2
  exit 1
fi
mkdir "${STAGING_DIRECTORY}/package"
tar xzf "${STAGING_DIRECTORY}/${TARBALL_NAME}" -C "${STAGING_DIRECTORY}/package"
if [[ ! -x "${STAGING_DIRECTORY}/package/config.sh" || ! -x "${STAGING_DIRECTORY}/package/svc.sh" ]]; then
  echo "Runner archive is missing executable setup scripts." >&2
  exit 1
fi

for ((i = 1; i <= NUM_RUNNERS; i++)); do
  RUNNER_DIR="${HOME}/actions-runner-${i}"
  if [[ -f "${RUNNER_DIR}/.runner" ]]; then
    continue
  fi
  mkdir -p "$RUNNER_DIR"
  cp -R "${STAGING_DIRECTORY}/package/." "$RUNNER_DIR/"
  (
    cd "$RUNNER_DIR"
    printf 'RUNNER_LOGRETENTION=%s\nWORKER_LOGRETENTION=%s\nRUNNER_LOGSIZE=%s\nWORKER_LOGSIZE=%s\n' \
      "$LOG_RETENTION" "$LOG_RETENTION" "$LOG_SIZE" "$LOG_SIZE" >> .env
    chmod 600 .env
    run_bounded ./config.sh --url "$REPO_URL" --token "$TOKEN" --name "wat2do-scraper-${i}" \
      --labels "wat2do-scraper" --work "_work" --unattended
    run_bounded ./svc.sh install
    run_bounded ./svc.sh start
    verify_service
  )
  echo "Configured runner ${RUNNER_DIR}."
done
