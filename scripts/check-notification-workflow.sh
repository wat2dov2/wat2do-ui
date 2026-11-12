#!/usr/bin/env bash
set -euo pipefail

# Official actionlint release archives, verified against their published SHA256.
version=1.7.12
offline=false
if [[ "${1:-}" == --offline ]]; then
  offline=true
  shift
fi
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) platform=darwin_arm64; checksum=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  Darwin-x86_64) platform=darwin_amd64; checksum=5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644 ;;
  Linux-aarch64|Linux-arm64) platform=linux_arm64; checksum=325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6 ;;
  Linux-x86_64) platform=linux_amd64; checksum=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  *) printf '%s\n' 'Unsupported platform for pinned actionlint release.' >&2; exit 1 ;;
esac

archive="actionlint_${version}_${platform}.tar.gz"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/wat2do-workflow-tools"
mkdir -p "$cache"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

checksum_matches() {
  local file="$1" actual
  [[ -f "$file" ]] || return 1
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$file")"
  else
    actual="$(shasum -a 256 "$file")"
  fi
  [[ "${actual%% *}" == "$checksum" ]]
}

if ! checksum_matches "$cache/$archive"; then
  if [[ "$offline" == true ]]; then
    if [[ -f "$cache/$archive" ]]; then
      printf '%s\n' 'Pinned actionlint cache checksum mismatch.' >&2
      exit 1
    fi
    printf '%s\n' 'Pinned actionlint cache is not provisioned; run bash scripts/check-notification-workflow.sh first.' >&2
    exit 69
  fi
  rm -f "$cache/$archive"
  curl --fail --location --silent --show-error --connect-timeout 15 --max-time 60 --retry 2 \
    "https://github.com/rhysd/actionlint/releases/download/v${version}/${archive}" \
    --output "$temporary/$archive"
  if ! checksum_matches "$temporary/$archive"; then
    printf '%s\n' 'Downloaded actionlint archive checksum mismatch.' >&2
    exit 1
  fi
  mv "$temporary/$archive" "$cache/$archive"
fi
tar -xzf "$cache/$archive" -C "$temporary" actionlint
if [[ $# == 0 ]]; then
  set -- .github/workflows/process-notification.yml .github/workflows/ci-cd.yml
fi
"$temporary/actionlint" -shellcheck= -pyflakes= "$@"
