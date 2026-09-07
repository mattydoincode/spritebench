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
cp .env.example .env.local   # add your OpenAI key
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

## Environments

Two env files, both gitignored, each with a checked-in template:

| File          | Template               | Holds                                    |
| ------------- | ---------------------- | ---------------------------------------- |
| `.env.local`  | `.env.example`         | the dev container and `./data-pg`        |
| `.env.remote` | `.env.remote.example`  | credentials for the deployed Postgres and R2 |

Commands that touch a database or a bucket come in pairs, and every one names
the file it loads rather than inheriting whatever is exported:

| Local                   | Remote                          |
| ----------------------- | ------------------------------- |
| `npm run db:migrate`    | `npm run db:migrate:remote`     |
| `npm run db:studio`     | `npm run db:studio:remote`      |
| `npm run psql`          | `npm run psql:remote`           |
| `npm run verify:s3`     | `npm run verify:s3:remote`      |

Each prints the database and bucket it resolved before doing anything:

```
[env] .env.remote
      db      spritebench@spritebench-prod-....db.ondigitalocean.com/spritebench
      storage r2 bucket=spritebench-prod
```

`scripts/env-run.sh` clears every variable the templates declare before it
loads the file. Node and Next both decline to overwrite a variable that is
already set, so without that step a stale `export DATABASE_URL` in your shell
beats the file and the command runs against the wrong database while appearing
to work.

`npm run mirror:storage` is the one command that loads both files, since it
copies from the local data directory into the remote bucket.

## Deploying

Pushing to `main` deploys: all three components have `deploy_on_push`. The rest
is for changing or watching the deployment itself.

| Command                  | Does                                              |
| ------------------------ | ------------------------------------------------- |
| `npm run deploy:status`  | components, last deploy, assigned origin          |
| `npm run deploy:logs`    | follow the worker                                 |
| `npm run deploy:logs:web`| follow the web service                            |
| `npm run deploy:spec`    | apply `infra/do-app.local.yaml` after a spec edit |

`deploy:spec` reads `infra/do-app.local.yaml`, not the committed
`infra/do-app.yaml`. The committed spec leaves every `SECRET` value empty so it
can be checked in, and `doctl apps update` overwrites every variable it is
handed — applying the committed file would blank the R2 credentials and the
encryption key, and the worker would then fail to decrypt stored provider keys.
Keep the unredacted copy locally and edit both.

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
