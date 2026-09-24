import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createDebouncedIdle,
  isDevReadyLine,
  warmupUrls,
  WARMUP_COOKIE,
  WARMUP_PATHS,
  WARMUP_PROJECT_ID
} from "@/dev/warmup";

describe("warmup", () => {
  it("covers the pages that matter for local navigation", () => {
    expect(WARMUP_PATHS).toEqual([
      "/",
      "/sign-in",
      "/projects",
      `/projects/${WARMUP_PROJECT_ID}`,
      "/settings"
    ]);
  });

  it("builds absolute urls against the origin", () => {
    expect(warmupUrls("http://127.0.0.1:4300")).toEqual([
      "http://127.0.0.1:4300/",
      "http://127.0.0.1:4300/sign-in",
      "http://127.0.0.1:4300/projects",
      `http://127.0.0.1:4300/projects/${WARMUP_PROJECT_ID}`,
      "http://127.0.0.1:4300/settings"
    ]);
  });

  it("sends a presence-only session cookie so middleware does not redirect", () => {
    expect(WARMUP_COOKIE.startsWith("authjs.session-token=")).toBe(true);
  });

  it("recognizes webpack and turbopack ready lines", () => {
    expect(isDevReadyLine("✓ Ready in 1.8s")).toBe(true);
    expect(isDevReadyLine("✓ Ready in 234ms")).toBe(true);
    expect(isDevReadyLine("○ Compiling / ...")).toBe(false);
  });
});

describe("createDebouncedIdle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires once after quiet, not on each bump", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const idle = createDebouncedIdle(2000, fn);

    idle.bump();
    idle.bump();
    vi.advanceTimersByTime(1999);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
    idle.cancel();
  });

  it("cancel drops a pending fire", () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const idle = createDebouncedIdle(2000, fn);

    idle.bump();
    idle.cancel();
    vi.advanceTimersByTime(5000);
    expect(fn).not.toHaveBeenCalled();
  });
});
