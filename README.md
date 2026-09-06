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

Everything the app reads comes from `.env.local`. The dev scripts strip those
variables from the environment they hand to the servers, so a stale `export` in
your shell cannot silently override the file.

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
