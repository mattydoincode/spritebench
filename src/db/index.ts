import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";
import { requiresSsl as needsSsl, withoutSslParams } from "./url";

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
      "DATABASE_URL is required. Point it at Postgres (a managed cluster, or run a local container)."
    );
  }
  return url;
}

/**
 * What the pools are actually given: the URL minus its TLS parameters, so
 * `sslConfig()` is the only thing deciding TLS. See `withoutSslParams`.
 */
export function poolConnectionString(): string {
  return withoutSslParams(connectionString());
}

/**
 * One pool per process, shared with pg-boss so the two do not double up on
 * connections. Railway's Postgres has a modest connection ceiling.
 */
export function pgPool(): Pool {
  if (pool) return pool;

  pool = new Pool({
    connectionString: poolConnectionString(),
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
 * network name -- a container's `host.containers.internal`, a compose service
 * alias -- so DATABASE_SSL exists to state it outright, and `sslmode` in the
 * URL is honored as a fallback.
 *
 * For this to hold, the pools get `poolConnectionString()` rather than the raw
 * URL. `pg` lets a parsed connection string overwrite the options object, so
 * an `sslmode` left in place would beat whatever is returned here.
 *
 * `rejectUnauthorized: false` because managed providers front Postgres with
 * certificates that do not chain to a public root.
 */
export function sslConfig(): { rejectUnauthorized: false } | undefined {
  return needsSsl(connectionString(), process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : undefined;
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
