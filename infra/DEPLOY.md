# Deploying

Two services from this one repo, both built from the same `Dockerfile`, sharing
one Postgres and one R2 bucket.

| Service  | Start command                        | Notes                           |
| -------- | ------------------------------------ | ------------------------------- |
| `web`    | `node_modules/.bin/next start -p $PORT` | Health check at `/api/health` |
| `worker` | `node dist/worker.mjs`               | No HTTP port; drains on SIGTERM |

Nothing here is platform-specific except the deploy descriptors. **DigitalOcean
App Platform** is the primary target (`infra/do-app.yaml`); `railway.json` and
`railway.worker.json` are kept for Railway. Sections 2 onward apply to both.

## 1. Postgres

### DigitalOcean

Create the Managed Postgres cluster **first**, then put its name in
`databases[0].cluster_name` in `infra/do-app.yaml`. A database marked
`production: true` attaches an existing cluster and will not provision one, so
a placeholder name fails the deploy. The smallest sane tier is 1 GiB / 1 vCPU /
10 GiB at about $15/month, which includes daily backups and 7-day
point-in-time recovery.

`version` must match the live cluster or the deploy is rejected. Read it back
rather than assuming, since DigitalOcean's default moves:

```
doctl databases list
```

A new cluster contains only `defaultdb` and the `doadmin` superuser, so create
the database and role the spec names. Do not fall back to `doadmin` — the app
has no need for a superuser, and a leaked application credential should not be
able to drop the cluster's other databases.

```
doctl databases db create <cluster-id> spritebench
doctl databases user create <cluster-id> spritebench
```

A newly created role can neither create schemas nor create tables, so grant
both. Connect as `doadmin` **to the `spritebench` database** — the grants are
per-database and silently apply to the wrong one from `defaultdb`:

```sql
GRANT ALL ON DATABASE spritebench TO spritebench;
GRANT ALL ON SCHEMA public TO spritebench;
```

Two grants because two different privileges are missing, and each surfaces as a
differently worded error partway through the same migration:

- `CREATE ON DATABASE` for `CREATE SCHEMA`. Drizzle keeps its ledger in a
  `drizzle` schema and pg-boss owns a `pgboss` schema, so both the migration
  and the worker need this. Without it: `permission denied for database`.
- `CREATE ON SCHEMA public` for the tables themselves. Since PostgreSQL 15,
  `PUBLIC` no longer holds this implicitly. Without it: `permission denied for
  schema public`.

```
doctl apps spec validate infra/do-app.yaml
doctl apps create --spec infra/do-app.yaml
```

`${db.DATABASE_URL}` is a bindable variable resolved from the `databases` entry
named `db`; it is set once at app level so the web service, the worker and the
migration job cannot drift apart.

Set `DATABASE_SSL=require` here. DigitalOcean's managed Postgres is reached
over the network with a certificate that does not chain to a public root.

Migrations run as a `PRE_DEPLOY` job, after the build and before either
component takes traffic, and a non-zero exit aborts the deploy. Attach it to
exactly one component — two concurrent migrators race.

Note the connection ceiling: a 1 GiB cluster allows roughly 22 usable
connections, and every component opens both a query pool and a pg-boss pool.
The peak is a redeploy, when the outgoing web and worker still hold their pools
while the new migration job opens its own. Hence `DATABASE_POOL_MAX=4` and
`QUEUE_POOL_MAX=2`: 12 connections steady, 16 mid-deploy, leaving room for a
`psql` session.

### Railway

Railway injects `DATABASE_URL`; reference it from both services rather than
copying the value. Migrations run as the `web` service's pre-deploy command.

Leave `DATABASE_SSL` unset (or `disable`): Railway's private network is the
default path and is not TLS-terminated. Set it to `require` only if you point
`DATABASE_URL` at the public proxy host. It governs the query pool and pg-boss
together; if only one of the two can connect, this is the setting to check.

Railway Postgres is a container on a volume rather than a managed service with
an SLA. Enable point-in-time recovery on day one and keep periodic `pg_dump`
copies off-platform.

## 2. R2 bucket

Create the bucket and an API token scoped to it (Object Read & Write), then set
on both services:

```
STORAGE_DRIVER=r2
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=...
```

Apply the CORS policy in `r2-cors.json` after replacing the placeholder origin
with the deployed app's origin. **This is required, not optional:** the browser
fetches `/api/assets/[id]/source`, which answers with a 302 to a signed R2 URL,
so the image bytes are cross-origin. Without the policy the library renders
nothing and the console fills with CORS errors.

```bash
npm run r2:cors        # wrangler r2 bucket cors set
npm run r2:cors:show   # read back what R2 actually stored
```

The file is in Wrangler's shape (`rules[].allowed.origins`), not the S3 shape
(`AllowedOrigins`) the R2 dashboard editor shows. Wrangler rejects S3-style keys
outright, so prefer the command over pasting this file into the dashboard.

Verify the credentials and the policy before deploying:

```
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
R2_BUCKET=... npm run verify:s3
```

To carry an existing local library over, run `scripts/mirror-storage.ts` with
both drivers configured.

## 3. Secrets and limits

Set on both services:

```
ENCRYPTION_KEY=          # openssl rand -base64 32 -- changing it orphans stored keys
FREE_ASSET_LIMIT=100
ASSET_RETENTION_DAYS=30
MAX_IMAGES_PER_REQUEST=40
WORKER_CONCURRENCY=4
```

`ENCRYPTION_KEY` must be identical across services: the web service encrypts
provider keys and the worker decrypts them.

Leave `OPENAI_API_KEY` unset in production. It exists as a local convenience
fallback, and in production every user brings their own key.

These live in the app-level `envs` block of `infra/do-app.yaml`, which
propagates to all three components. The `SECRET`-typed ones are committed with
empty values and **set once in the control panel**, under Settings →
App-Level Environment Variables. Nothing in this repo, and no file on your
machine, holds a production credential.

That places a rule on every later change: use `npm run spec:push`, never
`doctl apps update --spec`. App Platform has no secret store separate from the
app — the panel edits the same spec — and a submitted spec replaces the
previous one, so applying the committed file would unset all four. `spec:push`
reads the live spec, carries its `EV[1:...]` values across, and refuses to
submit a `SECRET` with no value.

Two consequences of App Platform's encryption worth knowing. A secret must be
plaintext on **first** submission: DigitalOcean rejects `EV[...]` values before
the app exists, which is why the app is created without them and they are typed
in afterward. And until they are set, the worker refuses to start and
`/api/health` reports which names are missing — the intermediate state is loud
rather than a running app that fails on its first real request.

Set a spend cap: Billing → Alerts on DigitalOcean, Workspace Usage on Railway
(minimum $10).

## 4. Scaling notes

`WORKER_CONCURRENCY` is provider calls in flight per worker process, and each
one holds a Postgres connection while it writes. Keep
`DATABASE_POOL_MAX + QUEUE_POOL_MAX` across every service below the Postgres
connection ceiling. The defaults (10 and 4) suit two services on Railway;
`infra/do-app.yaml` lowers them to 6 and 3 for three components against a 1 GiB
DigitalOcean cluster's 22 usable connections.

Do not fold the worker into the web container to save an instance. `sharp`
spikes memory through libvips on large PNGs, so an OOM kill during image
processing would take the web server down with it — users would see 502s
because someone else's generation was large. You would also lose independent
restarts and per-service metrics, and the platform health check only watches
the HTTP port, making a dead worker inside a healthy web container invisible.

Scaling the worker horizontally needs no coordination: pg-boss hands each job
to exactly one consumer, and a duplicate delivery is a no-op because a job
whose provider call already completed is never called again.

## 5. Verifying a deploy

```
curl -s https://<app>/api/health | jq
```

Expect `status: "ok"` and three passing checks. The storage check writes and
deletes a probe object, so it catches a read-only token that configuration
alone would not reveal. A 503 names which dependency is unreachable.
