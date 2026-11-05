#!/bin/bash
#
# Deploys one commit of wat2do: the Mac mini's API release, then the website on AWS.
#
# Builds in a persistent checkout (~/wat2do-build, so cargo and npm reuse their
# caches), assembles ~/wat2do-data/releases/<sha>, applies pending migrations,
# switches ~/wat2do-data/releases/current to it and restarts the API. When the
# API fails its health check, current goes back to the previous release and the
# API restarts again. Keeps the three newest releases.
# Once the API is healthy, the website's OpenNext build goes to the web bucket
# and the Lambda functions (infra/terraform/web), and CloudFront's cache is
# cleared (docs/projects/mac-mini-hosting.md).
#
# Usage: infra/mac-mini/deploy.sh <commit sha>
# The workflow job that runs it allows one deploy at a time.

set -euo pipefail

sha="${1:?usage: deploy.sh <commit sha>}"
data="$HOME/wat2do-data"
build="$HOME/wat2do-build"
releases="$data/releases"
release="$releases/$sha"
domain="gui/$(id -u)"
health_timeout_seconds=900
# infra/terraform/web's outputs; the AWS CLI profile is its wat2do-web-deploy user.
export AWS_PROFILE=wat2do-deploy AWS_REGION=ca-central-1 AWS_PAGER=""
web_bucket="wat2do-web-291667884807"
distribution_id="E2O3B7GJXMY1W8"
site="https://wat2do.io"

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/opt/homebrew/opt/postgresql@17/bin:/usr/bin:/bin:/usr/sbin:/sbin"
# shellcheck disable=SC1091
. "$HOME/.nvm/nvm.sh" >/dev/null
nvm use 22 >/dev/null

log() { echo "deploy: $*"; }

log "building $sha"
git -C "$build" fetch --quiet origin
git -C "$build" checkout --quiet --detach "$sha"

binaries=(wat2do-api wat2do-send-notifications wat2do-poster-payouts)
(cd "$build/rust" && cargo build --release --quiet "${binaries[@]/#/--bin=}")

# Dependencies change rarely; reinstall only when their lockfile does.
stamp() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
frontend_lock="$(stamp "$build/frontend/package-lock.json")"
if [ "$(cat "$build/frontend/.deploy-lock-stamp" 2>/dev/null)" != "$frontend_lock" ]; then
  (cd "$build/frontend" && npm ci --no-audit --no-fund --loglevel=error)
  echo "$frontend_lock" >"$build/frontend/.deploy-lock-stamp"
fi
python_lock="$(stamp "$build/backend/requirements.txt")"
if [ ! -x "$data/venv/bin/python" ]; then
  "${PYTHON:-/opt/anaconda3/bin/python3.12}" -m venv "$data/venv"
fi
if [ "$(cat "$data/venv/.deploy-lock-stamp" 2>/dev/null)" != "$python_lock" ]; then
  "$data/venv/bin/pip" install --quiet --disable-pip-version-check -r "$build/backend/requirements.txt"
  echo "$python_lock" >"$data/venv/.deploy-lock-stamp"
fi

# OpenNext finds the directory Next traces from (the repository root, which
# next.config.ts sets as turbopack.root) by the nearest lockfile, so frontend's
# lockfile sits at the root while it builds.
restore_lockfile() { [ ! -f "$build/package-lock.json" ] || mv "$build/package-lock.json" "$build/frontend/package-lock.json"; }
trap restore_lockfile EXIT
mv "$build/frontend/package-lock.json" "$build/package-lock.json"
(
  cd "$build/frontend"
  set -a
  # shellcheck disable=SC1091
  . "$data/config/web-build.env"
  set +a
  export APP_VERSION="$sha"
  rm -rf .open-next
  # Next 16.4 sometimes stops once on its advisory check and passes on a rerun.
  npx --no-install open-next build || npx --no-install open-next build
)
restore_lockfile

log "assembling $release"
rm -rf "$release.partial"
mkdir -p "$release.partial/bin" "$release.partial/infra"
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude 'tests' --exclude '.env' \
  "$build/backend/" "$release.partial/backend/"
for binary in "${binaries[@]}"; do
  cp "$build/rust/target/release/$binary" "$release.partial/bin/$binary"
done
rsync -a "$build/infra/mac-mini/" "$release.partial/infra/mac-mini/"
rm -rf "$release"
mv "$release.partial" "$release"

log "applying migrations"
(
  set -a
  # shellcheck disable=SC1091
  . "$data/config/backend.env"
  set +a
  bash "$build/scripts/migrate-database.sh"
)

previous="$(readlink "$releases/current" 2>/dev/null || true)"

switch_to() {
  ln -sfn "$1" "$releases/current.next"
  mv -h "$releases/current.next" "$releases/current"
  launchctl kickstart -k "$domain/io.wat2do.api"
}

healthy() {
  local deadline=$((SECONDS + health_timeout_seconds))
  until curl --silent --fail --max-time 5 -o /dev/null http://127.0.0.1:8000/health \
    && curl --silent --fail --max-time 5 -o /dev/null -H 'Host: api.wat2do.io' http://127.0.0.1:8080/health; do
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 5
  done
}

log "switching to $sha"
switch_to "$release"
if ! healthy; then
  if [ -n "$previous" ]; then
    log "health check failed; back to $(basename "$previous")"
    switch_to "$previous"
    healthy || log "the previous release is not healthy either"
  fi
  exit 1
fi

# The API and its migrations go first, so the website never runs ahead of them.
open_next="$build/frontend/.open-next"

# Every top-level entry of frontend/public needs its own CloudFront behavior.
behaviors="$(aws cloudfront get-distribution-config --id "$distribution_id" \
  --query 'DistributionConfig.CacheBehaviors.Items[].PathPattern' --output text | tr '\t' '\n')"
for entry in "$build/frontend/public"/*; do
  name="$(basename "$entry")"
  [ -d "$entry" ] && name="$name/*"
  grep -qxF "/$name" <<<"$behaviors" || {
    log "CloudFront has no behavior for /$name; run terraform apply in infra/terraform/web first"
    exit 1
  }
done

log "uploading the website's files"
# Hashed build files never change; everything else is revalidated after the
# cache clear below.
aws s3 sync "$open_next/assets/_next/static" "s3://$web_bucket/_assets/_next/static" \
  --only-show-errors --cache-control "public, max-age=31536000, immutable"
aws s3 sync "$open_next/assets" "s3://$web_bucket/_assets" --exclude "_next/static/*" \
  --only-show-errors --cache-control "public, max-age=0, s-maxage=31536000, must-revalidate"
aws s3 sync "$open_next/cache" "s3://$web_bucket/_cache" --only-show-errors

log "deploying $sha to the website's functions"
# Each bundle goes through the web bucket: S3 retries a slow upload in parts,
# where Lambda's own upload drops it on the Mac's uplink.
update_function() {
  local name="$1" bundle="$2" zip
  zip="$(mktemp -t "$name").zip"
  (cd "$bundle" && rm -f "$zip" && zip -qr -X "$zip" .)
  aws s3 cp "$zip" "s3://$web_bucket/_deploy/$name.zip" --only-show-errors
  aws lambda update-function-code --function-name "$name" \
    --s3-bucket "$web_bucket" --s3-key "_deploy/$name.zip" >/dev/null
  aws lambda wait function-updated-v2 --function-name "$name"
  rm -f "$zip"
}
update_function wat2do-web-server "$open_next/server-functions/default"
update_function wat2do-web-revalidation "$open_next/revalidation-function"
update_function wat2do-web-warmer "$open_next/warmer-function"

invalidation="$(aws cloudfront create-invalidation --distribution-id "$distribution_id" \
  --paths '/*' --query Invalidation.Id --output text)"
aws cloudfront wait invalidation-completed --distribution-id "$distribution_id" --id "$invalidation"

if ! curl --silent --fail --max-time 30 -o /dev/null "$site/healthz" \
  || ! curl --silent --fail --max-time 30 -o /dev/null \
    "https://uwaterloo.wat2do.io/api/discovery?school=uwaterloo&resource=events"; then
  log "the website is not healthy after deploying $sha"
  exit 1
fi

# Keep the three newest releases, never the one current points at.
current_target="$(readlink "$releases/current")"
find "$releases" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -print0 \
  | xargs -0 ls -1dt | tail -n +4 | while read -r old; do
    [ "$old" = "$current_target" ] || rm -rf "$old"
  done
log "deployed $sha"
