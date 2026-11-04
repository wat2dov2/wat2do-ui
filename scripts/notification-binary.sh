#!/usr/bin/env bash
set -euo pipefail

# The Rust binary the process-notification workflow runs, built once per source change
# in the runner's tool cache. It records the source it was built from (the committed
# files in rust/browser-worker-sources.txt, fingerprinted exactly as rust/build.rs does),
# so a binary from another source is rebuilt, and one that still does not match this
# checkout fails the job before anything is recorded. The Mac keeps the most recently
# used builds (binaries_to_keep), so reruns of older commits reuse theirs.
#
#   scripts/notification-binary.sh controls     export the step timeouts and source fingerprint
#   scripts/notification-binary.sh fingerprint  print this checkout's source fingerprint
#   scripts/notification-binary.sh ensure       reuse or build the binary, export NOTIFICATION_BINARY

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
controls="$repository/backend/controlbox/notification_workflow.json"

fail() {
  printf '::error::%s Rerun this notification; its media has not been processed.\n' "$1" >&2
  exit 1
}

control() {
  python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))[sys.argv[2]])' "$controls" "$1"
}

fingerprint() {
  python3 - "$repository" <<'PY'
import hashlib
import subprocess
import sys

repository = sys.argv[1]
with open(f"{repository}/rust/browser-worker-sources.txt", encoding="utf-8") as listing:
    paths = [line.strip() for line in listing if line.strip() and not line.startswith("#")]
tree = subprocess.run(
    ["git", "-C", repository, "ls-tree", "-r", "HEAD", "--", *paths],
    capture_output=True, text=True, check=True,
).stdout
blobs = "".join(f"{line}\n" for line in tree.splitlines() if "/tests/" not in line)
print(hashlib.sha256(blobs.encode()).hexdigest())
PY
}

free_mb() {
  python3 - "$1" <<'PY'
import os
import shutil
import sys

path = sys.argv[1]
while not os.path.exists(path) and path != os.path.dirname(path):
    path = os.path.dirname(path)
print(shutil.disk_usage(path).free // (1024 * 1024))
PY
}

case "${1:-}" in
  controls)
    {
      printf 'build_timeout_minutes=%s\n' "$(control build_timeout_minutes)"
      printf 'process_timeout_minutes=%s\n' "$(control process_timeout_minutes)"
      printf 'fingerprint=%s\n' "$(fingerprint)"
    } >> "$GITHUB_OUTPUT"
    ;;
  fingerprint)
    fingerprint
    ;;
  ensure)
    runtime="${NOTIFICATION_RUNTIME_ROOT:?NOTIFICATION_RUNTIME_ROOT is not set}"
    expected="$(fingerprint)"
    binary="$runtime/bin/$expected/wat2do-browser"
    built_from() {
      "$binary" source-fingerprint 2>/dev/null || true
    }
    if [[ -x "$binary" && "$(built_from)" == "$expected" ]]; then
      echo "Reusing the notification binary built from this source."
    else
      minimum="$(control minimum_free_disk_mb)"
      for path in "$runtime" "${TMPDIR:-/tmp}"; do
        free="$(free_mb "$path")"
        if (( free < minimum )); then
          fail "Insufficient disk space to build the notification binary: $free MiB free; need $minimum MiB."
        fi
      done
      # Hosted runners build in the checkout, where the dependency cache restores.
      target="${CARGO_TARGET_DIR:-$runtime/rust-target}"
      if [[ -d "$target" ]] && (( $(du -sm "$target" | cut -f1) > $(control build_target_max_mb) )); then
        # Old dependency builds accumulate across lockfile changes; one rebuild bounds them.
        rm -rf "$target"
        echo "Cleared the notification build cache above its size cap."
      fi
      cargo="$(command -v cargo || true)"
      if [[ -z "$cargo" ]]; then
        cargo="$HOME/.cargo/bin/cargo"
      fi
      if [[ ! -x "$cargo" ]]; then
        fail "Rust's cargo is not installed on this runner."
      fi
      echo "Building the notification binary for source $expected."
      if ! CARGO_TARGET_DIR="$target" \
        CARGO_BUILD_JOBS="$(control build_jobs)" nice -n 10 "$cargo" build --release --locked \
        --quiet --manifest-path "$repository/rust/Cargo.toml" --bin wat2do-browser; then
        fail "The notification binary could not be built."
      fi
      mkdir -p "$(dirname "$binary")"
      cp "$target/release/wat2do-browser" "$binary.partial"
      mv -f "$binary.partial" "$binary"
    fi
    # Most recently used first; older builds beyond the cap are removed.
    touch "$(dirname "$binary")"
    keep="$(control binaries_to_keep)"
    ls -1t "$runtime/bin" | tail -n +"$((keep + 1))" | while read -r stale; do
      rm -rf "${runtime:?}/bin/$stale"
    done
    if [[ "$(built_from)" != "$expected" ]]; then
      fail "The notification binary does not match this checkout's source."
    fi
    printf 'NOTIFICATION_BINARY=%s\n' "$binary" >> "$GITHUB_ENV"
    ;;
  *)
    printf '%s\n' 'Usage: scripts/notification-binary.sh controls|fingerprint|ensure' >&2
    exit 64
    ;;
esac
