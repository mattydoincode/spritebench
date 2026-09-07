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
# see Configuration below for the .env.local this needs
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

Every variable the app reads is declared in one place: `.env`. There are no
fallback values in `src/`, so a variable has exactly one home and a missing one
is a named error rather than a silent default.

| Where                  | Tracked | Holds                                                |
| ---------------------- | ------- | ---------------------------------------------------- |
| `.env`                 | **yes** | every variable, with the values production wants; secrets blank |
| `.env.local`           | no      | overrides that point at the dev container and local disk, plus local secrets |
| DigitalOcean panel     | n/a     | production secrets                                   |

Precedence runs the other way: an already-set variable wins, then `.env.local`,
then `.env`. So the platform beats the image and your machine beats both. Node
and Next both implement this by declining to overwrite, which is also why
`scripts/env-run.sh` clears the variables `.env` declares before loading —
without it a stale `export DATABASE_URL` in your shell beats the file and the
command runs against the wrong database while appearing to work.

`.env` holds production values rather than local ones, and ships inside the
image. That direction is deliberate: forgetting to set `STORAGE_DRIVER` in
production then yields `r2` rather than writing images to a container
filesystem that disappears on the next deploy. The cost is that a fresh clone
needs `.env.local`:

```
DATABASE_URL=postgres://art:art@localhost:5433/art_studio
DATABASE_SSL=disable
STORAGE_DRIVER=local
SPRITEBENCH_DATA_DIR=./data-pg
ENCRYPTION_KEY=<openssl rand -base64 32>
```

Don't copy a default down into `.env.local` just to read it — it will quietly
go stale and win.

Commands that touch a database or a bucket load both files and print what they
resolved before doing anything:

```
[env] .env .env.local
      db      art@localhost/art_studio
      storage local dir=./data-pg
```

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

Production configuration lives in the control panel, not in the repo, and
`infra/do-app.yaml` carries no values at all — only components, the build, the
health check, and the `${db.DATABASE_URL}` binding. Adding a production
override means typing it into the panel; nothing needs declaring in git first.

That works because App Platform has no secret store separate from the app. The
panel's environment variable editor writes the same spec `doctl` submits, and a
submitted spec *replaces* the previous one — so `doctl apps update --spec
infra/do-app.yaml` would unset every panel variable, leaving an app that serves
pages while no image can be read or written.

`spec:push` exists for exactly that reason: it reads the live spec first and
carries every variable the committed file doesn't mention back across, secrets
as `EV[1:...]` ciphertext. Declaring a key in the file overrides the panel,
which is how a value gets promoted into version control when it stops being a
secret.

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
