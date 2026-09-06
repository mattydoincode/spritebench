import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sslConfig } from "@/db";

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

  it("still requires a connection string to decide", () => {
    expect(() => sslConfig()).toThrow(/DATABASE_URL/);
  });
});
