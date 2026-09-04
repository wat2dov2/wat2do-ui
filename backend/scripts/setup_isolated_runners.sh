#!/usr/bin/env bash
set -euo pipefail

# setup_isolated_runners.sh
# Sets up 3 isolated GitHub Actions self-hosted runner directories on macOS.
# Each runner has its own root directory, config, and _work directory to prevent checkout collisions.

REPO_URL="${1:-}"
TOKEN="${2:-}"
NUM_RUNNERS="${3:-3}"
RUNNER_VERSION="${4:-2.322.0}"

if [[ -z "$REPO_URL" || -z "$TOKEN" ]]; then
  echo "Usage: ./backend/scripts/setup_isolated_runners.sh <REPO_URL> <GITHUB_RUNNER_TOKEN> [NUM_RUNNERS] [RUNNER_VERSION]"
  echo "Example: ./backend/scripts/setup_isolated_runners.sh https://github.com/TonyQiu/wat2do-v2 AABBCCDDEEFF123456789"
  exit 1
fi

ARCH="osx-arm64"
if [[ "$(uname -m)" == "x86_64" ]]; then
  ARCH="osx-x64"
fi

TARBALL_NAME="actions-runner-${ARCH}-${RUNNER_VERSION}.tar.gz"
DOWNLOAD_URL="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/${TARBALL_NAME}"

echo "==> Setting up ${NUM_RUNNERS} isolated runners for ${REPO_URL} (${ARCH})..."

# Cache the tarball in /tmp so we only download once
if [[ ! -f "/tmp/${TARBALL_NAME}" ]]; then
  echo "==> Downloading runner package ${DOWNLOAD_URL}..."
  curl -o "/tmp/${TARBALL_NAME}" -L "${DOWNLOAD_URL}"
fi

for i in $(seq 1 "$NUM_RUNNERS"); do
  RUNNER_DIR="${HOME}/actions-runner-${i}"
  RUNNER_NAME="wat2do-scraper-${i}"

  echo "----------------------------------------------------"
  echo "==> Configuring Runner #${i}: ${RUNNER_NAME} at ${RUNNER_DIR}"
  echo "----------------------------------------------------"

  # Stop and uninstall any existing service in this directory if present
  if [[ -d "$RUNNER_DIR" && -f "$RUNNER_DIR/svc.sh" ]]; then
    echo "Stopping and uninstalling existing service in ${RUNNER_DIR}..."
    (cd "$RUNNER_DIR" && ./svc.sh stop 2>/dev/null || true)
    (cd "$RUNNER_DIR" && ./svc.sh uninstall 2>/dev/null || true)
  fi

  mkdir -p "$RUNNER_DIR"
  cd "$RUNNER_DIR"

  # Unpack runner package
  tar xzf "/tmp/${TARBALL_NAME}"

  # Configure runner
  echo "Registering runner ${RUNNER_NAME}..."
  ./config.sh \
    --url "$REPO_URL" \
    --token "$TOKEN" \
    --name "$RUNNER_NAME" \
    --labels "wat2do-scraper" \
    --work "_work" \
    --unattended \
    --replace

  # Install and start LaunchAgent service
  echo "Installing LaunchAgent service for ${RUNNER_NAME}..."
  ./svc.sh install
  ./svc.sh start

  echo "Runner #${i} (${RUNNER_NAME}) is running!"
done

echo ""
echo "===================================================="
echo "Successfully configured and started ${NUM_RUNNERS} isolated runners!"
echo "Each runner operates in its own directory:"
for i in $(seq 1 "$NUM_RUNNERS"); do
  echo "  - ${HOME}/actions-runner-${i} (_work)"
done
echo "===================================================="
