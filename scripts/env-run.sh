#!/usr/bin/env bash
#
# Runs a command with one of the project's env files loaded.
#
#   scripts/env-run.sh .env.local tsx scripts/migrate.ts
#   scripts/env-run.sh .env.remote sh -c 'psql "$DATABASE_URL"'
#   scripts/env-run.sh .env.local,.env.remote tsx scripts/mirror-storage.ts
#
# Comma-separated files are applied left to right, so later files win. That is
# how a command reads the local data directory and the remote bucket at once.
#
# Two things this does that `node --env-file` cannot:
#
#   1. Clears every variable the example files declare before loading. Node and
#      Next both decline to overwrite a variable that is already set, so a
#      stale `export DATABASE_URL` in the calling shell otherwise beats the
#      file and the command runs against the wrong database while looking fine.
#   2. Prints the database and bucket it resolved, before running anything.
#      The whole point of naming environments is to stop guessing which one is
#      about to be written to.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ "$#" -lt 2 ]; then
  echo "usage: $(basename "$0") <env-file[,env-file...]> <command> [args...]" >&2
  exit 64
fi

FILES="$1"
shift

# Anything the templates name is app configuration, so it belongs to the env
# file rather than to whatever happens to be exported in this shell.
for template in .env.example .env.remote.example; do
  [ -f "$template" ] || continue
  while read -r key; do
    [ -n "$key" ] && unset "$key"
  done < <(grep -oE '^[A-Z][A-Z0-9_]*' "$template" | sort -u)
done

# Deliberately parsed rather than sourced: sourcing expands `$` and backticks
# in values, which mangles generated secrets and can execute them.
load() {
  local file="$1" line key value
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    case "$line" in [A-Za-z_]*=*) ;; *) continue ;; esac

    key="${line%%=*}"
    value="${line#*=}"
    value="${value%$'\r'}"

    case "$value" in
      '"'*'"') value="${value#\"}"; value="${value%\"}" ;;
      "'"*"'") value="${value#\'}"; value="${value%\'}" ;;
    esac

    export "$key=$value"
  done <"$file"
}

IFS=',' read -ra chosen <<<"$FILES"
for file in "${chosen[@]}"; do
  if [ ! -f "$file" ]; then
    echo "env-run: no $file" >&2
    echo "  copy the template first: cp ${file%.local}.example $file" >&2
    exit 1
  fi
  load "$file"
done

# Reported without the password, so this is safe in a shared terminal.
describe_database() {
  [ -n "${DATABASE_URL:-}" ] || { echo "(DATABASE_URL unset)"; return; }

  local rest="${DATABASE_URL#*://}" creds host_path user host name
  case "$rest" in
    *@*) creds="${rest%%@*}"; host_path="${rest##*@}"; user="${creds%%:*}" ;;
    *) host_path="$rest"; user="(no user)" ;;
  esac

  host="${host_path%%[:/]*}"
  name="${host_path##*/}"
  name="${name%%\?*}"

  echo "$user@$host/$name"
}

describe_storage() {
  if [ "${STORAGE_DRIVER:-local}" = "r2" ]; then
    echo "r2 bucket=${R2_BUCKET:-(R2_BUCKET unset)}"
  else
    echo "local dir=${SPRITEBENCH_DATA_DIR:-./data}"
  fi
}

printf '[env] %s\n' "$FILES" >&2
printf '      db      %s\n' "$(describe_database)" >&2
printf '      storage %s\n' "$(describe_storage)" >&2

exec "$@"
