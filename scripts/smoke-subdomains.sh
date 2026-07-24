#!/usr/bin/env bash
#
# Post-deploy smoke test for school subdomain scoping.
#
# Two production incidents this layer has already caused:
#   1. CloudFront stripped the viewer host, so every school subdomain silently
#      served the default school's events.
#   2. A stale rewrite in the app self-proxied to the origin host, turning
#      school subdomains into a request loop that hung until timeout.
#
# Both were invisible to unit tests and to a plain uptime check, because the
# pages still returned HTTP 200 with the wrong data. This asserts the thing that
# actually matters: a school subdomain must not serve another school's feed.

set -euo pipefail

APEX="${SMOKE_APEX_HOST:-wat2do.io}"
SCHOOL_HOST="${SMOKE_SCHOOL_HOST:-utsc.wat2do.io}"
SCHOOL_SLUG="${SMOKE_SCHOOL_SLUG:-utsc}"
DEFAULT_SLUG="${SMOKE_DEFAULT_SLUG:-uwaterloo}"
# Generous, but far below the ~25s hang the rewrite loop produced.
TIMEOUT="${SMOKE_TIMEOUT_SECONDS:-15}"

failures=0

fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

fetch() {
  # Prints the body; non-zero exit means the request itself failed or timed out.
  curl -fsS --max-time "$TIMEOUT" "https://$1/"
}

echo "Smoke testing subdomain scoping (apex=$APEX school=$SCHOOL_HOST)"

# 1. The apex must serve the default school.
if apex_body="$(fetch "$APEX")"; then
  if grep -q "school\\\\\":\\\\\"$DEFAULT_SLUG" <<<"$apex_body"; then
    echo "ok: $APEX serves $DEFAULT_SLUG"
  else
    fail "$APEX did not serve $DEFAULT_SLUG data"
  fi
else
  fail "$APEX did not respond within ${TIMEOUT}s"
fi

# 2. The school subdomain must respond promptly. A timeout here is the signature
#    of the rewrite loop, so treat it as a hard failure rather than a flake.
if school_body="$(fetch "$SCHOOL_HOST")"; then
  echo "ok: $SCHOOL_HOST responded within ${TIMEOUT}s"

  # 3. The critical assertion: it must never serve the default school's feed.
  if grep -q "school\\\\\":\\\\\"$DEFAULT_SLUG" <<<"$school_body"; then
    fail "$SCHOOL_HOST is serving $DEFAULT_SLUG events - subdomain scoping is broken"
  else
    echo "ok: $SCHOOL_HOST is not serving $DEFAULT_SLUG events"
  fi

  # 4. If the subdomain has events at all, they must be its own. A school with an
  #    empty feed is legitimate, so absence of markers is not a failure.
  if grep -q "school\\\\\":\\\\\"$SCHOOL_SLUG" <<<"$school_body"; then
    echo "ok: $SCHOOL_HOST serves $SCHOOL_SLUG events"
  elif grep -q 'school\\":\\"' <<<"$school_body"; then
    fail "$SCHOOL_HOST served events belonging to neither $SCHOOL_SLUG nor an empty feed"
  else
    echo "ok: $SCHOOL_HOST has an empty feed (no events for $SCHOOL_SLUG)"
  fi
else
  fail "$SCHOOL_HOST did not respond within ${TIMEOUT}s (rewrite loop signature)"
fi

if [ "$failures" -gt 0 ]; then
  echo "Subdomain smoke test failed with $failures problem(s)." >&2
  exit 1
fi

echo "Subdomain smoke test passed."
