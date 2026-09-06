#!/usr/bin/env bash
#
# Brings the whole local stack up in tmux: Postgres, the Next.js web server,
# and the queue worker.
#
# Normally reached through npm, which is where the scripts are listed:
#
#   npm run dev:up        start everything and attach
#   npm run dev:down      stop everything
#   npm run dev:status    what is running right now
#   npm run dev:attach    reattach to a running session
#   npm run dev:restart   down, then up
#   npm run dev:psql      a shell on the database
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SESSION="art-studio"
PG_CONTAINER="art-studio-postgres"
PG_VOLUME="art-studio-pgdata"
PG_IMAGE="docker.io/library/postgres:17-alpine"
PG_PORT="5433"
PG_USER="art"
PG_PASSWORD="art"
PG_DB="art_studio"
WEB_PORT="4300"

say() { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die() {
  printf '\033[31m✗\033[0m %s\n' "$*" >&2
  exit 1
}

# --- container runtime ------------------------------------------------------
# docker-compose.yml is here for anyone who has Docker, but neither
# docker-compose nor podman-compose is required: one `run` is all this needs.
RUNTIME=""
for candidate in docker podman; do
  if command -v "$candidate" >/dev/null 2>&1; then
    RUNTIME="$candidate"
    break
  fi
done
[ -n "$RUNTIME" ] || die "need docker or podman on PATH"

command -v tmux >/dev/null 2>&1 || die "need tmux on PATH"

# --- environment hygiene ----------------------------------------------------
# Next and tsx both read .env.local, and neither overrides a variable that is
# already set. So an app variable exported in the calling shell silently wins
# over the file and the servers run against the wrong database or data
# directory -- a genuinely confusing failure, because the app looks fine and
# just serves the wrong content.
#
# Every key .env.example declares is therefore stripped from the environment
# the panes inherit, which makes .env.local the single source of truth.
ENV_PREFIX="env"
if [ -f .env.example ]; then
  while read -r key; do
    [ -n "$key" ] && ENV_PREFIX="$ENV_PREFIX -u $key"
  done < <(grep -oE '^[A-Z][A-Z0-9_]*' .env.example | sort -u)
fi

container_state() {
  "$RUNTIME" inspect "$PG_CONTAINER" --format '{{.State.Status}}' 2>/dev/null || echo "absent"
}

pg_ready() {
  "$RUNTIME" exec "$PG_CONTAINER" pg_isready -U "$PG_USER" -d "$PG_DB" >/dev/null 2>&1
}

start_postgres() {
  case "$(container_state)" in
    running)
      say "Postgres already running on :$PG_PORT"
      ;;
    exited | created | stopped)
      say "starting existing Postgres container"
      "$RUNTIME" start "$PG_CONTAINER" >/dev/null
      ;;
    *)
      say "creating Postgres on :$PG_PORT (volume $PG_VOLUME)"
      "$RUNTIME" volume create "$PG_VOLUME" >/dev/null 2>&1 || true
      "$RUNTIME" run -d \
        --name "$PG_CONTAINER" \
        -e POSTGRES_USER="$PG_USER" \
        -e POSTGRES_PASSWORD="$PG_PASSWORD" \
        -e POSTGRES_DB="$PG_DB" \
        -p "$PG_PORT:5432" \
        -v "$PG_VOLUME:/var/lib/postgresql/data" \
        --restart unless-stopped \
        "$PG_IMAGE" >/dev/null
      ;;
  esac

  printf '  waiting for Postgres'
  for _ in $(seq 1 60); do
    if pg_ready; then
      printf ' ready\n'
      return 0
    fi
    printf '.'
    sleep 1
  done

  printf '\n'
  die "Postgres did not become ready. Logs: $RUNTIME logs $PG_CONTAINER"
}

# --- commands ---------------------------------------------------------------
cmd_up() {
  start_postgres

  say "applying migrations"
  $ENV_PREFIX npm run --silent db:migrate

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    say "session '$SESSION' already exists, attaching"
    cmd_attach
    return
  fi

  say "starting web and worker in tmux"

  # A detached session has no client to take its size from, and tmux's 80x24
  # default splits three ways into panes too narrow to read. tmux resizes to
  # the real terminal on attach, so a generous size here costs nothing.
  tmux new-session -d -s "$SESSION" -n dev -c "$ROOT" -x 250 -y 60

  # Interactive shells rather than bare commands, so Ctrl-C leaves a usable
  # prompt in the pane instead of destroying it along with the scrollback.
  tmux send-keys -t "$SESSION:dev.0" "$ENV_PREFIX npm run dev" C-m

  tmux split-window -h -t "$SESSION:dev" -c "$ROOT"
  tmux send-keys -t "$SESSION:dev.1" "$ENV_PREFIX npm run worker" C-m

  tmux split-window -v -t "$SESSION:dev.1" -c "$ROOT"
  tmux send-keys -t "$SESSION:dev.2" \
    "clear && echo 'web :$WEB_PORT | postgres :$PG_PORT | ./scripts/dev.sh down to stop'" C-m

  tmux select-layout -t "$SESSION:dev" main-vertical
  tmux select-pane -t "$SESSION:dev.2"

  say "waiting for the web server"
  for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://localhost:$WEB_PORT/" 2>/dev/null; then
      break
    fi
    sleep 1
  done

  cmd_status
  cmd_attach
}

cmd_down() {
  if tmux has-session -t "$SESSION" 2>/dev/null; then
    say "stopping tmux session"
    tmux kill-session -t "$SESSION"
  fi

  # A server started outside tmux -- an earlier `npm run dev`, say -- still
  # holds the port and would be inherited silently by the next `up`.
  if command -v lsof >/dev/null 2>&1; then
    local stray
    stray="$(lsof -ti:"$WEB_PORT" 2>/dev/null || true)"
    if [ -n "$stray" ]; then
      warn "killing stray listener on :$WEB_PORT ($(echo "$stray" | tr '\n' ' '))"
      # shellcheck disable=SC2086
      kill $stray 2>/dev/null || true
    fi
  fi

  if [ "$(container_state)" = "running" ]; then
    say "stopping Postgres (data is kept in volume $PG_VOLUME)"
    "$RUNTIME" stop "$PG_CONTAINER" >/dev/null
  fi

  say "down"
}

cmd_status() {
  printf '\n'
  printf '  postgres   %s' "$(container_state)"
  if [ "$(container_state)" = "running" ]; then
    pg_ready && printf ' (accepting connections on :%s)' "$PG_PORT" || printf ' (starting)'
  fi
  printf '\n'

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    printf '  tmux       session "%s" up, %s pane(s)\n' \
      "$SESSION" "$(tmux list-panes -t "$SESSION:dev" 2>/dev/null | wc -l | tr -d ' ')"
  else
    printf '  tmux       no session\n'
  fi

  local health
  health="$(curl -fsS --max-time 3 "http://localhost:$WEB_PORT/api/health" 2>/dev/null || true)"
  if [ -n "$health" ]; then
    printf '  web        :%s %s\n' "$WEB_PORT" \
      "$(printf '%s' "$health" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(`health=${j.status} db=${j.checks.database.state} storage=${j.checks.storage.state} queue=${j.checks.queue.state}`)})' 2>/dev/null || echo "responding")"
  else
    printf '  web        :%s not responding\n' "$WEB_PORT"
  fi
  printf '\n'
}

cmd_attach() {
  tmux has-session -t "$SESSION" 2>/dev/null || die "no session. Run: ./scripts/dev.sh up"

  if [ -n "${TMUX:-}" ]; then
    tmux switch-client -t "$SESSION"
  elif [ -t 1 ]; then
    tmux attach-session -t "$SESSION"
  else
    # Called from a pipe, a CI step or an agent: the session is up and healthy,
    # there is just no terminal to hand it to.
    say "session running in the background. Attach with: npm run dev:attach"
  fi
}

cmd_psql() {
  [ "$(container_state)" = "running" ] || die "Postgres is not running. Run: ./scripts/dev.sh up"
  exec "$RUNTIME" exec -it "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB"
}

cmd_help() {
  cat <<'USAGE'
The whole local stack in one tmux session.

  npm run dev:up        Postgres, migrations, then web + worker; attaches
  npm run dev:down      the session, any stray :4300 listener, and Postgres
  npm run dev:restart   down, then up
  npm run dev:status    Postgres, tmux and /api/health at a glance
  npm run dev:attach    reattach to a running session
  npm run dev:psql      a psql shell on the dev database

Panes:  0 web (:4300)   1 worker   2 free shell
tmux:   detach with Ctrl-b d, move between panes with Ctrl-b arrow

Postgres data lives in the named volume "art-studio-pgdata" and survives
`down`. Every variable declared in .env.example is stripped from the panes'
environment, so .env.local is the only thing that configures the app.

To run just one piece: npm run dev (web only), npm run worker (worker only).
USAGE
}

case "${1:-up}" in
  up) cmd_up ;;
  down | stop) cmd_down ;;
  restart)
    cmd_down
    cmd_up
    ;;
  status | ps) cmd_status ;;
  attach) cmd_attach ;;
  psql | db) cmd_psql ;;
  help | -h | --help) cmd_help ;;
  *)
    cmd_help >&2
    exit 2
    ;;
esac
