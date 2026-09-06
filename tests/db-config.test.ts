import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { poolConnectionString, sslConfig } from "@/db";
import { withoutSslParams } from "@/db/url";

const KEYS = ["DATABASE_URL", "DATABASE_SSL"] as const;

let saved: Partial<Record<(typeof KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const REQUIRE = { rejectUnauthorized: false };

/**
 * This setting is shared by the query pool and pg-boss. When they disagreed,
 * the queue connected while every query failed, which reads like a broken app
 * rather than a misconfigured one -- so the resolution order is pinned here.
 */
describe("sslConfig", () => {
  it("is off by default, because a private network hop is not TLS-terminated", () => {
    process.env.DATABASE_URL = "postgres://art:art@postgres.railway.internal:5432/art";
    expect(sslConfig()).toBeUndefined();
  });

  it("does not infer TLS from an unfamiliar hostname", () => {
    // The bug this replaces: any host that was not literally localhost was
    // assumed to be a managed provider terminating TLS.
    process.env.DATABASE_URL = "postgres://art:art@host.containers.internal:5433/art";
    expect(sslConfig()).toBeUndefined();
  });

  it("honors sslmode in the URL", () => {
    process.env.DATABASE_URL = "postgres://art@db.example.com:5432/art?sslmode=require";
    expect(sslConfig()).toEqual(REQUIRE);

    process.env.DATABASE_URL = "postgres://art@db.example.com:5432/art?sslmode=disable";
    expect(sslConfig()).toBeUndefined();
  });

  it("lets DATABASE_SSL state it outright", () => {
    process.env.DATABASE_URL = "postgres://art:art@localhost:5433/art";

    process.env.DATABASE_SSL = "require";
    expect(sslConfig()).toEqual(REQUIRE);

    process.env.DATABASE_SSL = "disable";
    expect(sslConfig()).toBeUndefined();
  });

  it("takes DATABASE_SSL over a conflicting sslmode", () => {
    process.env.DATABASE_URL = "postgres://art@db.example.com:5432/art?sslmode=require";
    process.env.DATABASE_SSL = "disable";
    expect(sslConfig()).toBeUndefined();
  });

  it("accepts boolean spellings, since platform env vars arrive as strings", () => {
    process.env.DATABASE_URL = "postgres://art:art@localhost:5433/art";

    process.env.DATABASE_SSL = "true";
    expect(sslConfig()).toEqual(REQUIRE);

    process.env.DATABASE_SSL = "FALSE";
    expect(sslConfig()).toBeUndefined();
  });

  it("treats the verify modes and prefer as asking for TLS", () => {
    for (const mode of ["prefer", "verify-ca", "verify-full"]) {
      process.env.DATABASE_URL = `postgres://art@db.example.com:5432/art?sslmode=${mode}`;
      expect(sslConfig(), mode).toEqual(REQUIRE);
    }

    process.env.DATABASE_URL = "postgres://art@db.example.com:5432/art?sslmode=allow";
    expect(sslConfig()).toBeUndefined();
  });

  it("still requires a connection string to decide", () => {
    expect(() => sslConfig()).toThrow(/DATABASE_URL/);
  });
});

/**
 * `pg` merges a parsed connection string over the options object, and
 * `?sslmode=require` parses to `ssl: {}` -- TLS with full verification. Left
 * in place it overrides sslConfig()'s `rejectUnauthorized: false`, and since
 * managed providers hand out URLs containing it, every query fails with
 * SELF_SIGNED_CERT_IN_CHAIN. Stripping it is what makes sslConfig() decisive.
 */
describe("withoutSslParams", () => {
  it("removes every parameter pg would read TLS from", () => {
    const stripped = withoutSslParams(
      "postgres://u:p@h:25060/d?sslmode=require&sslrootcert=/ca.crt&uselibpqcompat=true"
    );
    expect(stripped).toBe("postgres://u:p@h:25060/d");
  });

  it("keeps unrelated parameters, and the separator with them", () => {
    expect(withoutSslParams("postgres://u:p@h:5432/d?sslmode=require&application_name=worker")).toBe(
      "postgres://u:p@h:5432/d?application_name=worker"
    );
  });

  it("leaves a URL with no query string untouched", () => {
    expect(withoutSslParams("postgres://u:p@h:5432/d")).toBe("postgres://u:p@h:5432/d");
  });

  it("does not re-encode the password", () => {
    // Parsing via URL and re-serializing rewrites percent escapes, which turns
    // a valid credential into a failed login.
    const url = "postgres://u:p%2Fa%40ss@h:5432/d?sslmode=require";
    expect(withoutSslParams(url)).toBe("postgres://u:p%2Fa%40ss@h:5432/d");
  });

  it("matches parameter names case-insensitively", () => {
    expect(withoutSslParams("postgres://u@h:5432/d?SSLMode=require")).toBe("postgres://u@h:5432/d");
  });

  it("is what the pools are handed", () => {
    process.env.DATABASE_URL = "postgres://u:p@h:25060/d?sslmode=require";
    expect(poolConnectionString()).toBe("postgres://u:p@h:25060/d");
    // While the mode still drives the decision.
    expect(sslConfig()).toEqual(REQUIRE);
  });
});
