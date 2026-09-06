import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";

export type Database = NodePgDatabase<typeof schema>;

/**
 * Accepted anywhere a repository function can run either standalone or inside
 * a caller's transaction.
 */
export type Transaction =
  | Database
  | Parameters<Parameters<Database["transaction"]>[0]>[0];

let pool: Pool | null = null;
let database: Database | null = null;

export function connectionString(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "DATABASE_URL is required. Point it at Postgres (Railway provides one, or run a local container)."
    );
  }
  return url;
}

/**
 * One pool per process, shared with pg-boss so the two do not double up on
 * connections. Railway's Postgres has a modest connection ceiling.
 */
export function pgPool(): Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: connectionString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: sslConfig()
  });

  pool.on("error", (error) => {
    console.error("[db] idle client error", error);
  });

  return pool;
}

/**
 * Every pool in the process has to agree about TLS, so this is the one place
 * that decides. pg-boss opens its own pool against the same database, and a
 * disagreement here presents as one half of the app working: the queue
 * connects while queries fail, or the reverse.
 *
 * Inferring from the hostname is a guess that gets it wrong on any private
 * network name -- Railway's `postgres.railway.internal`, a container's
 * `host.containers.internal`, a compose service alias -- so DATABASE_SSL
 * exists to state it outright, and `sslmode` in the URL is honored too.
 *
 * `rejectUnauthorized: false` because managed providers front Postgres with
 * certificates that do not chain to a public root.
 */
export function sslConfig(): { rejectUnauthorized: false } | undefined {
  return requiresSsl() ? { rejectUnauthorized: false } : undefined;
}

function requiresSsl(): boolean {
  const explicit = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (explicit === "disable" || explicit === "false") return false;
  if (explicit === "require" || explicit === "true") return true;

  const url = connectionString();
  if (/sslmode=disable/.test(url)) return false;
  if (/sslmode=require/.test(url)) return true;

  // Default off: an unencrypted hop inside a provider's private network is the
  // common case, and failing closed here would break local and container runs
  // for a setting the deployment can state explicitly.
  return false;
}

export function db(): Database {
  if (database) return database;

  database = drizzle(pgPool(), { schema });
  return database;
}

export async function closeDb(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
  database = null;
}
