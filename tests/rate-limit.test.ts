import { describe, expect, it } from "vitest";
import { callerKey, clientIp, PER_IP, policyFor, RateLimiter } from "@/server/rateLimit";

const PROJECT = "/api/projects/88037620-97f8-4d3b-bc3f-862fc0dfcad2";

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe("policyFor", () => {
  it("sorts requests into buckets", () => {
    expect(policyFor("GET", `${PROJECT}/assets/x/source`).name).toBe("read");
    expect(policyFor("POST", `${PROJECT}/doc`).name).toBe("write");
    expect(policyFor("DELETE", `${PROJECT}/assets/x`).name).toBe("write");
    expect(policyFor("POST", `${PROJECT}/generate`).name).toBe("generate");
    expect(policyFor("POST", `${PROJECT}/rerun`).name).toBe("generate");
    expect(policyFor("POST", `${PROJECT}/assets/upload`).name).toBe("upload");
    expect(policyFor("POST", "/api/projects").name).toBe("create");
    expect(policyFor("POST", "/api/tokens").name).toBe("create");
    expect(policyFor("POST", `${PROJECT}/share-links`).name).toBe("create");
    expect(policyFor("POST", "/api/feedback").name).toBe("create");
    expect(policyFor("POST", "/api/auth/signin/google").name).toBe("auth");
    expect(policyFor("GET", "/api/auth/session").name).toBe("read");
  });
});

describe("RateLimiter", () => {
  it("allows a burst up to capacity, then says how long to wait", () => {
    const time = clock();
    const limiter = new RateLimiter(time.now);
    const policy = { name: "t", capacity: 3, refillPerSecond: 1 };

    expect([1, 2, 3].map(() => limiter.take("a", policy))).toEqual([0, 0, 0]);
    expect(limiter.take("a", policy)).toBe(1);

    time.advance(1000);
    expect(limiter.take("a", policy)).toBe(0);
  });

  it("keeps callers and policies apart", () => {
    const limiter = new RateLimiter(clock().now);
    const policy = { name: "t", capacity: 1, refillPerSecond: 1 };
    const other = { name: "u", capacity: 1, refillPerSecond: 1 };

    expect(limiter.take("a", policy)).toBe(0);
    expect(limiter.take("b", policy)).toBe(0);
    expect(limiter.take("a", other)).toBe(0);
    expect(limiter.take("a", policy)).toBeGreaterThan(0);
  });

  it("forgets idle buckets", () => {
    const time = clock();
    const limiter = new RateLimiter(time.now);
    const policy = { name: "t", capacity: 1, refillPerSecond: 1 };

    for (let i = 0; i < 999; i++) limiter.take(`k${i}`, policy);
    time.advance(11 * 60 * 1000);
    limiter.take("fresh", policy);

    expect(limiter.size).toBe(1);
  });

  it("never limits a heavy session in a big project", () => {
    const time = clock();
    const limiter = new RateLimiter(time.now);
    const take = (method: string, path: string) =>
      Math.max(limiter.take("me", policyFor(method, path)), limiter.take("ip", PER_IP));
    const denied: string[] = [];
    const run = (method: string, path: string) => {
      if (take(method, path) > 0) denied.push(`${method} ${path}`);
    };

    // Open a ~170 image project cold, twice in a row: JSON, then a thumb and
    // a full source per image.
    for (let open = 0; open < 2; open++) {
      for (const path of ["doc", "assets", "jobs", "palettes", "templates", "game-assets", "sharing"]) {
        run("GET", `${PROJECT}/${path}`);
      }
      for (let i = 0; i < 170; i++) {
        run("GET", `${PROJECT}/assets/${i}/source?variant=thumb`);
        run("GET", `${PROJECT}/assets/${i}/source`);
      }
    }

    // Then five minutes of dragging things around the scene: a flush every
    // 250ms and a poll every 800ms, plus a generate every 20 seconds.
    for (let ms = 0; ms < 5 * 60 * 1000; ms += 50) {
      time.advance(50);
      if (ms % 250 === 0) run("POST", `${PROJECT}/doc`);
      if (ms % 800 === 0) run("GET", `${PROJECT}/doc?since=1`);
      if (ms % 20_000 === 0) run("POST", `${PROJECT}/generate`);
    }

    // And delete a whole folder of 170 images, one request each.
    for (let i = 0; i < 170; i++) run("DELETE", `${PROJECT}/assets/${i}`);

    expect(denied).toEqual([]);
  });

  it("stops a generate loop", () => {
    const limiter = new RateLimiter(clock().now);
    const policy = policyFor("POST", `${PROJECT}/generate`);
    const allowed = Array.from({ length: 100 }, () => limiter.take("me", policy)).filter(
      (wait) => wait === 0
    );

    expect(allowed.length).toBe(policy.capacity);
  });
});

describe("caller identity", () => {
  it("hashes secrets and reads the platform's client address", () => {
    expect(callerKey("token")).not.toContain("token");
    expect(callerKey("token")).toBe(callerKey("token"));
    expect(clientIp(new Headers({ "do-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }))).toBe(
      "1.2.3.4"
    );
    expect(clientIp(new Headers({ "x-forwarded-for": "5.6.7.8, 10.0.0.1" }))).toBe("5.6.7.8");
  });
});
