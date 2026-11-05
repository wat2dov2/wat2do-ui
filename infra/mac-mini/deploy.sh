#!/bin/bash
#
# Deploys one commit of wat2do: the Mac mini's release, then the website on Vercel.
#
# Builds in a persistent checkout (~/wat2do-build, so cargo and npm reuse their
# caches), assembles ~/wat2do-data/releases/<sha>, applies pending migrations,
# switches ~/wat2do-data/releases/current to it and restarts the API and the
# Mac's website. When either fails its health check, current goes back to the
# previous release and both restart again. Keeps the three newest releases.
# Once the Mac is healthy, the same checkout deploys to Vercel production, which
# builds frontend/ there (docs/projects/mac-mini-hosting.md).
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
vercel_cli="vercel@65.11.0"
vercel_scope="tonyqiu123s-projects"
vercel_project="wat2do"

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

(
  cd "$build/frontend"
  set -a
  # shellcheck disable=SC1091
  . "$data/config/web-build.env"
  set +a
  export APP_VERSION="$sha"
  # Next 16.4 sometimes stops once on its advisory check and passes on a rerun.
  npm run build --silent || npm run build --silent
)

log "assembling $release"
rm -rf "$release.partial"
mkdir -p "$release.partial/bin" "$release.partial/infra"
rsync -a --exclude '.venv' --exclude '__pycache__' --exclude 'tests' --exclude '.env' \
  "$build/backend/" "$release.partial/backend/"
for binary in "${binaries[@]}"; do
  cp "$build/rust/target/release/$binary" "$release.partial/bin/$binary"
done
ln -s "$(command -v node)" "$release.partial/bin/node"
rsync -a "$build/frontend/.next/standalone/" "$release.partial/web/"
rsync -a "$build/frontend/public/" "$release.partial/web/frontend/public/"
rsync -a "$build/frontend/.next/static/" "$release.partial/web/frontend/.next/static/"
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
  launchctl kickstart -k "$domain/io.wat2do.web"
}

healthy() {
  local deadline=$((SECONDS + health_timeout_seconds))
  until curl --silent --fail --max-time 5 -o /dev/null http://127.0.0.1:8000/health \
    && curl --silent --fail --max-time 5 -o /dev/null http://127.0.0.1:3000/healthz \
    && curl --silent --fail --max-time 10 -o /dev/null -H 'Host: uwaterloo.wat2do.io' \
      'http://127.0.0.1:8080/api/discovery?school=uwaterloo&resource=events'; do
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
# The Vercel CLI uses the Mac user's own login (vercel login, kept in its
# auth.json and refreshed by the CLI), so no token file is kept here.
log "deploying $sha to Vercel"
npx --yes "$vercel_cli" deploy "$build" --prod --yes \
  --scope "$vercel_scope" --project "$vercel_project" \
  --build-env "APP_VERSION=$sha"

# Keep the three newest releases, never the one current points at.
current_target="$(readlink "$releases/current")"
find "$releases" -mindepth 1 -maxdepth 1 -type d ! -name '*.partial' -print0 \
  | xargs -0 ls -1dt | tail -n +4 | while read -r old; do
    [ "$old" = "$current_target" ] || rm -rf "$old"
  done
log "deployed $sha"
