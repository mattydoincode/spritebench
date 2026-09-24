/**
 * Dev-server route warmup. Next compiles App Router pages on first request;
 * hitting these after idle puts the common graph in memory so the next
 * navigation does not wait. Middleware redirects unauthenticated `/projects`
 * and `/settings` before `ensurePage`, so the cookie is a presence-only
 * forged session — enough to compile the shell, not to load data.
 */

export const WARMUP_PROJECT_ID = "00000000-0000-4000-8000-000000000001";

export const WARMUP_PATHS = [
  "/",
  "/sign-in",
  "/projects",
  `/projects/${WARMUP_PROJECT_ID}`,
  "/settings"
] as const;

export const WARMUP_COOKIE = "authjs.session-token=dev-warmup";

export function warmupUrls(origin: string): string[] {
  return WARMUP_PATHS.map((path) => new URL(path, origin).href);
}

export function isDevReadyLine(line: string): boolean {
  return line.includes("Ready in");
}

export function createDebouncedIdle(ms: number, fn: () => void): {
  bump: () => void;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return {
    bump() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    }
  };
}
