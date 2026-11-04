#!/usr/bin/env bash
#
# Applies backend/database/migrations to DATABASE_URL in version order, then
# tells the data API (PostgREST) to reload its schema cache.
#
# Each migration runs in one transaction with the row that records it in
# public.schema_migrations, so a failed migration leaves no trace and the next
# run starts again from it. The first run against an empty database starts from
# backend/database/baseline.sql (written by scripts/dump-schema-baseline.sh)
# when that file exists.
#
# Usage: DATABASE_URL=postgresql://... scripts/migrate-database.sh [--dry-run]
#   --dry-run  list what would be applied without changing the database.

set -euo pipefail

usage() {
  echo "Usage: DATABASE_URL=<postgres url> $0 [--dry-run]" >&2
  exit 2
}

dry_run=false
if [ "$#" -gt 1 ]; then
  usage
elif [ "$#" -eq 1 ]; then
  [ "$1" = --dry-run ] || usage
  dry_run=true
fi

database_url="${DATABASE_URL:?DATABASE_URL is required}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
migrations_dir="$repo_root/backend/database/migrations"
baseline="$repo_root/backend/database/baseline.sql"

# Migration files are UTF-8 whatever the caller's locale says.
export PGCLIENTENCODING=UTF8
if [ "$dry_run" = true ]; then
  # The server, not just this script, keeps a dry run from writing.
  export PGOPTIONS="${PGOPTIONS:+$PGOPTIONS }-c default_transaction_read_only=on"
fi

fail() {
  echo "migrate-database: $1" >&2
  shift
  if [ "$#" -gt 0 ]; then
    printf '%s\n' "$@" >&2
  fi
  exit 1
}

run_psql() {
  psql --dbname="$database_url" --no-psqlrc --quiet -v ON_ERROR_STOP=1 "$@"
}

query() {
  run_psql --tuples-only --no-align --field-separator=' ' --command="$1"
}

# Prints the newline-separated list in $1 one item per line, nothing when empty.
lines() {
  if [ -n "$1" ]; then
    printf '%s\n' "$1"
  fi
}

count() {
  if [ -z "$1" ]; then
    echo 0
  else
    printf '%s\n' "$1" | wc -l | tr -d ' '
  fi
}

contains() {
  case $'\n'"$1"$'\n' in
    *$'\n'"$2"$'\n'*) return 0 ;;
    *) return 1 ;;
  esac
}

# The version and name of every migration file, one "version name" per line in
# version order. Names are restricted so they can be quoted into SQL safely.
migration_file_pattern='^([0-9]{14})_([a-z0-9_]+)\.sql$'
migrations=""
shopt -s nullglob
for file in "$migrations_dir"/*.sql; do
  file_name="${file##*/}"
  [[ $file_name =~ $migration_file_pattern ]] ||
    fail "$file_name is not named <14-digit version>_<lowercase_name>.sql."
  migrations+="${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"$'\n'
done
shopt -u nullglob
[ -n "$migrations" ] || fail "No migration files in $migrations_dir."
migrations="$(printf '%s' "$migrations" | LC_ALL=C sort)"
file_versions="$(cut -d ' ' -f 1 <<<"$migrations")"
duplicate_versions="$(uniq -d <<<"$file_versions")"
[ -z "$duplicate_versions" ] || fail "Several migration files share a version:" "$duplicate_versions"

read_baseline_version() {
  local header_pattern='^-- baseline-version: ([0-9]{14})$' line
  while IFS= read -r line; do
    if [[ $line =~ $header_pattern ]]; then
      echo "${BASH_REMATCH[1]}"
      return
    fi
    # The header sits in the file's leading comment block.
    [[ $line == --* ]] || break
  done <"$baseline"
  fail "$baseline has no '-- baseline-version: <version>' header; regenerate it with scripts/dump-schema-baseline.sh."
}

# Work out how this database's history starts and which versions it records
# (or, before its first run, will record) without changing anything yet.
state="$(query "SELECT to_regclass('public.schema_migrations') IS NOT NULL,
  to_regclass('public.schools') IS NOT NULL")"
read -r has_history has_schema <<<"$state"
start=existing
case "$has_history $has_schema" in
  "t "*)
    recorded="$(query 'SELECT version FROM public.schema_migrations')"
    if [ -z "$recorded" ] && [ "$has_schema" = t ]; then
      fail "public.schema_migrations is empty but public.schools exists, so this database's migration state is unknown." \
        "Refusing to apply every migration on top of an existing schema; restore its history first."
    fi
    ;;
  "f f")
    if [ -f "$baseline" ]; then
      start=baseline
      baseline_version="$(read_baseline_version)"
      contains "$file_versions" "$baseline_version" ||
        fail "$baseline is at version $baseline_version, which has no migration file."
      recorded=""
      while read -r version _; do
        if ((10#$version <= 10#$baseline_version)); then
          recorded+="$version"$'\n'
        fi
      done <<<"$migrations"
    else
      start=empty
      recorded=""
    fi
    ;;
  *)
    fail "public.schools exists but public.schema_migrations does not, so this database's migration state is unknown." \
      "Refusing to apply every migration on top of an existing schema; record its history first."
    ;;
esac
recorded="$(lines "$recorded" | LC_ALL=C sort)"

# History drift is loud: every recorded version must still have its file.
unknown_versions="$(LC_ALL=C comm -13 <(lines "$file_versions") <(lines "$recorded"))"
[ -z "$unknown_versions" ] ||
  fail "The database records migrations that have no file in backend/database/migrations:" \
    "$unknown_versions" "Restore those files or correct public.schema_migrations before migrating."

pending="$(LC_ALL=C comm -23 <(lines "$file_versions") <(lines "$recorded"))"

# Refuse a migration dated before one already applied: it was written against
# an older schema than the database now has.
newest_recorded="${recorded##*$'\n'}"
if [ -n "$newest_recorded" ] && [ -n "$pending" ]; then
  stale_versions=""
  while read -r version; do
    if ((10#$version < 10#$newest_recorded)); then
      stale_versions+="$version"$'\n'
    fi
  done <<<"$pending"
  [ -z "$stale_versions" ] ||
    fail "These migrations are dated before $newest_recorded, the newest one applied:" \
      "$(lines "$stale_versions")" "Rename each to a version after $newest_recorded."
fi

history_table="CREATE TABLE public.schema_migrations (
    version text PRIMARY KEY,
    name text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.schema_migrations IS 'Migrations applied by scripts/migrate-database.sh.';"

case "$start" in
  baseline) first_step="applying backend/database/baseline.sql to this empty database, which records every migration through $baseline_version" ;;
  empty) first_step="applying every migration from the start, since the database is empty and backend/database/baseline.sql does not exist yet (scripts/dump-schema-baseline.sh writes it)" ;;
  existing) first_step="" ;;
esac

if [ "$dry_run" = true ]; then
  echo "Dry run, nothing changes."
  if [ -n "$first_step" ]; then
    echo "First run would start by $first_step."
  fi
  if [ -z "$pending" ]; then
    echo "No pending migrations."
  else
    echo "Pending migrations:"
    while read -r version name; do
      if contains "$pending" "$version"; then
        echo "  ${version}_${name}.sql"
      fi
    done <<<"$migrations"
  fi
  exit 0
fi

if [ -n "$first_step" ]; then
  echo "First run: $first_step."
fi
case "$start" in
  baseline)
    baseline_rows=""
    while read -r version name; do
      if contains "$recorded" "$version"; then
        baseline_rows+="${baseline_rows:+, }('$version', '$name')"
      fi
    done <<<"$migrations"
    run_psql --single-transaction --command="$history_table" \
      --command="INSERT INTO public.schema_migrations (version, name) VALUES $baseline_rows" \
      --file="$baseline"
    ;;
  empty)
    run_psql --command="$history_table"
    ;;
esac

if [ -z "$pending" ]; then
  echo "No pending migrations."
  exit 0
fi

# The record goes in before the file: many migrations wrap themselves in
# BEGIN/COMMIT, and their COMMIT then commits the record with their changes.
# psql warns about the nested BEGIN and the extra COMMIT; both are harmless.
while read -r version name <&3; do
  contains "$pending" "$version" || continue
  echo "Applying ${version}_${name}.sql"
  run_psql --single-transaction \
    --command="INSERT INTO public.schema_migrations (version, name) VALUES ('$version', '$name')" \
    --file="$migrations_dir/${version}_${name}.sql"
done 3<<<"$migrations"
echo "Applied $(count "$pending") migrations."

# The data API (PostgREST) caches the schema when it starts and answers
# "Could not find the table" for anything newer until it is told to reload.
run_psql --command="NOTIFY pgrst, 'reload schema'"
