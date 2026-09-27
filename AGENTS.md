# Agent instructions

## Production is hands-off

Never act on production directly. This covers AI agents and any automation run on
their behalf.

- **Never connect to the production database**, not even for a read-only query.
  That means no `psql`, Drizzle Studio, scripts or `npm run db:migrate:prod` using
  the `DATABASE_URL` in `.env.remote` or anything else that points at the
  DigitalOcean cluster.
- When production data needs changing (a wipe, a backfill, `is_admin`, clearing
  tokens), write the SQL, explain what it does, and hand it to the user to run
  themselves in their own client.
- Don't change the DigitalOcean app with `doctl` or `npm run spec:push`, and don't
  change the production R2 bucket (`npm run r2:cors:prod`, `wrangler`). Reading
  deploy status and logs with `doctl` is fine.
- Pushing `main` deploys to production (`deploy_on_push`). Only push when the
  user asks.
