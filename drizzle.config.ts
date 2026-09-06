import { defineConfig } from "drizzle-kit";
// Relative, not aliased: the Drizzle CLI loads this file without the app's
// path mapping.
import { requiresSsl, withoutSslParams } from "./src/db/url";

const url = process.env.DATABASE_URL ?? "";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Same reasoning as the runtime pools: leaving `sslmode` in the URL makes
    // pg verify a certificate that a managed provider cannot satisfy, so TLS
    // is decided here instead. Without this, `db:studio:remote` fails with
    // SELF_SIGNED_CERT_IN_CHAIN while the app itself works.
    url: withoutSslParams(url),
    ssl: requiresSsl(url, process.env.DATABASE_SSL) ? { rejectUnauthorized: false } : undefined
  },
  strict: true,
  verbose: true
});
