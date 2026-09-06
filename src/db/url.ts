/**
 * Connection-string handling, shared by the pools and by `drizzle.config.ts`.
 *
 * Deliberately free of imports so the Drizzle CLI can load it without pulling
 * in the schema or the pg driver, and string-based rather than URL-based so
 * nothing re-encodes the password on the way through.
 */

/**
 * Query parameters that `pg-connection-string` turns into its own `ssl`
 * config, and which therefore have to be removed for ours to survive.
 */
const SSL_PARAMS = ["ssl", "sslmode", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"];

function readParam(url: string, name: string): string | undefined {
  const start = url.indexOf("?");
  if (start === -1) return undefined;

  for (const part of url.slice(start + 1).split("&")) {
    const separator = part.indexOf("=");
    const key = separator === -1 ? part : part.slice(0, separator);
    if (key.toLowerCase() === name) {
      return separator === -1 ? "" : decodeURIComponent(part.slice(separator + 1));
    }
  }

  return undefined;
}

/**
 * The URL with TLS parameters stripped, which is what the pools are given.
 *
 * `pg` merges a parsed connection string *over* the options object -- see
 * `Object.assign({}, config, parse(config.connectionString))` in
 * connection-parameters.js -- and `?sslmode=require` parses to `ssl: {}`,
 * which is TLS with full certificate verification. That quietly replaces the
 * `rejectUnauthorized: false` from `sslConfig()`, and every query then fails
 * with SELF_SIGNED_CERT_IN_CHAIN against a managed provider whose certificate
 * does not chain to a public root.
 *
 * Managed providers put `sslmode=require` in the URL they hand out, so this
 * is not a hypothetical: DigitalOcean's string fails without this.
 */
export function withoutSslParams(url: string): string {
  const start = url.indexOf("?");
  if (start === -1) return url;

  const base = url.slice(0, start);
  const kept = url
    .slice(start + 1)
    .split("&")
    .filter((part) => {
      if (part === "") return false;
      const separator = part.indexOf("=");
      const key = separator === -1 ? part : part.slice(0, separator);
      return !SSL_PARAMS.includes(key.toLowerCase());
    });

  return kept.length > 0 ? `${base}?${kept.join("&")}` : base;
}

/**
 * Whether to connect over TLS. `explicit` is DATABASE_SSL, which wins: reading
 * it from the URL alone cannot distinguish a provider's public hostname from a
 * private network alias that terminates nothing.
 */
export function requiresSsl(url: string, explicit: string | undefined): boolean {
  const stated = explicit?.trim().toLowerCase();
  if (stated === "disable" || stated === "false") return false;
  if (stated === "require" || stated === "true") return true;

  const mode = readParam(url, "sslmode")?.toLowerCase();
  if (mode === undefined) {
    // Default off: an unencrypted hop inside a provider's private network is
    // the common case, and failing closed breaks local and container runs over
    // a setting the deployment can state outright.
    return false;
  }

  // `prefer` and the `verify-*` modes all ask for TLS. Only `disable` and
  // `allow` do not.
  return mode !== "disable" && mode !== "allow";
}
