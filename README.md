# Spritebench

A pipeline for generating, processing, and exporting game art — prompt an image
model, cut the background, quantize to a palette, downsample to a sprite, and
compose the results on a canvas to check how they read together.

Extracted from a Godot project; the app no longer depends on one.

## Running it

Needs Node, `tmux`, and a container runtime (`podman` or `docker`) for local
Postgres.

```bash
npm install
printf 'ENCRYPTION_KEY=%s\n' "$(openssl rand -base64 32)" > .env.local
npm run dev:up               # http://localhost:4300
```

`dev:up` starts Postgres, applies migrations, then brings up the web server and
the queue worker in a tmux session — three panes: web, worker, and a shell.
Detach with `Ctrl-b d`; the stack keeps running.

| Command               | Does                                                   |
| --------------------- | ------------------------------------------------------ |
| `npm run dev:up`      | whole stack, then attach                               |
| `npm run dev:down`    | stop everything (Postgres data is kept)                |
| `npm run dev:status`  | Postgres, tmux and `/api/health` at a glance           |
| `npm run dev:attach`  | reattach after detaching                               |
| `npm run dev:psql`    | a psql shell on the dev database                       |
| `npm run dev`         | just the web server                                    |
| `npm run worker`      | just the worker                                        |
| `npm test`            | unit tests                                             |
| `npm run typecheck`   | `tsc --noEmit`                                         |
| `npm run import:legacy` | pull a pre-Postgres `data/` directory into the app   |

## Configuration

Local development reads two files, in order:

| File         | Tracked | Holds                                            |
| ------------ | ------- | ------------------------------------------------ |
| `.env`       | **yes** | non-secret defaults: dev container, `./data-pg`, limits |
| `.env.local` | no      | secrets and machine-specific overrides           |

A fresh clone runs with no setup beyond an `ENCRYPTION_KEY` in `.env.local`.
Because `.env` is tracked, never put a credential in it.

**Production is not configured here.** Its values live in the DigitalOcean
control panel; nothing in the repo holds a production credential, and there is
no env file that points at production. That is deliberate — see below.

Commands that touch a database or a bucket load both files and print what they
resolved before doing anything:

```
[env] .env .env.local
      db      art@localhost/art_studio
      storage local dir=./data-pg
```

`scripts/env-run.sh` clears every variable `.env` declares before loading.
Node and Next both decline to overwrite a variable that is already set, so
without that step a stale `export DATABASE_URL` in your shell beats the file
and the command runs against the wrong database while appearing to work.

Missing or malformed configuration is reported at startup rather than at first
use: the worker refuses to start and `/api/health` fails, listing the variable
names involved and never their values. Without that, a missing
`ENCRYPTION_KEY` lets the app boot, serve pages and pass a health check, then
fail the first time someone saves a provider key.

## Deploying

Pushing to `main` deploys: all three components have `deploy_on_push`.
Migrations run as a `PRE_DEPLOY` job, so schema changes ship with the code that
needs them and nothing is applied from a laptop.

| Command                   | Does                                          |
| ------------------------- | --------------------------------------------- |
| `npm run deploy:status`   | components, last deploy, assigned origin      |
| `npm run deploy:logs`     | follow the worker                             |
| `npm run deploy:logs:web` | follow the web service                        |
| `npm run spec:diff`       | what a push would submit                      |
| `npm run spec:push`       | apply `infra/do-app.yaml` after a spec edit   |
| `npm run spec:pull`       | print the live spec                           |

Secrets are set once in the control panel and never leave it. App Platform has
no secret store separate from the app — the panel's environment variable editor
writes the same spec `doctl` submits — and a submitted spec *replaces* the
previous one. So `doctl apps update --spec infra/do-app.yaml` would unset every
credential, leaving an app that serves pages while no image can be read or
written.

`spec:push` exists for exactly that reason: it reads the live spec, carries its
`EV[1:...]` encrypted values across, and refuses to submit a `SECRET` with no
value. Structure stays in git, secrets stay in the panel, and no plaintext
credential is ever written to disk.

## Architecture

Two Node processes against one Postgres and one object store:

- **web** — Next.js routes. Enqueues work, never calls an image provider.
- **worker** — pg-boss consumer. Makes the provider call, stores the source
  PNG, generates a thumbnail, and prunes expired sources on a nightly cron.

Most image processing happens in the **browser**, in a Web Worker, so previews
cost the server nothing. `/api/assets/[id]/source` answers with a 302 to a
signed URL, so image bytes never pass through the app.

Storage is an interface with two drivers, chosen by `STORAGE_DRIVER`: the local
filesystem for development, Cloudflare R2 in production.

## Layout

- `src/core/` — pure image pipeline. No Node or DOM dependencies; runs
  unchanged in the browser worker and on the server.
- `src/db/` — Drizzle schema and the repository layer.
- `src/storage/` — the `Storage` interface plus the local and R2 drivers.
- `src/providers/` — the `ImageProvider` seam and the model registry.
- `src/queue/`, `src/worker/` — pg-boss setup and the worker entrypoint.
- `src/client/` — zustand store, React components, browser-side export.
- `app/api/` — route handlers.
- `infra/` — deploy specs and the runbook.

## Deploying

See [infra/DEPLOY.md](./infra/DEPLOY.md).
