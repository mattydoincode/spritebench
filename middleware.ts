import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { callerKey, clientIp, PER_IP, policyFor, RateLimiter } from "@/server/rateLimit";

/**
 * Rate-limits every request, then bounces unauthenticated page requests to
 * sign-in.
 *
 * Checks for the session cookie rather than calling `auth()`: a cookie check
 * is enough for a redirect, and a database round trip on every request is not
 * worth it here. It is not enough for authorization -- that is
 * `requireUser` and `requireMember`, which run in the handler against the
 * session table. A forged cookie gets you a page shell and a 401 from every
 * request it makes.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/api/auth", "/api/health"];

/**
 * A file in `public/`. Next serves that folder from the site root, so there
 * is no `/public` prefix to match; what marks those requests is the file
 * extension, which no page or route in this app has. They are public by
 * definition, and the signed-out pages need them (the logo).
 */
const STATIC_FILE = /\.[a-z0-9]+$/i;

/**
 * Public pages, matched exactly rather than by prefix -- `/` as a prefix
 * would make the entire app public, which is the kind of mistake that only
 * shows up in production.
 */
const PUBLIC_PAGES = new Set(["/", "/privacy", "/terms"]);

const SESSION_COOKIES = ["__Secure-authjs.session-token", "authjs.session-token"];

/** Module state; see `src/server/rateLimit.ts` for why one process is enough. */
const limiter = new RateLimiter();

/**
 * Who a request counts against: the session or PAT it carries, otherwise its
 * address. A forged cookie still gets a bucket of its own, which is why every
 * request also counts against its address.
 */
function limitRequest(request: NextRequest): NextResponse | null {
  const ip = clientIp(request.headers);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const session = SESSION_COOKIES.map((name) => request.cookies.get(name)?.value).find(Boolean);
  const caller = bearer ?? session;

  const wait = Math.max(
    limiter.take(caller ? callerKey(caller) : `ip:${ip}`, policyFor(request.method, request.nextUrl.pathname)),
    limiter.take(ip, PER_IP)
  );
  if (wait === 0) return null;

  return NextResponse.json(
    { error: `too many requests; try again in ${wait}s` },
    { status: 429, headers: { "Retry-After": String(wait) } }
  );
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/") && STATIC_FILE.test(pathname)) return NextResponse.next();

  // The health check is the platform's, polled from inside its network.
  if (pathname !== "/api/health") {
    const limited = limitRequest(request);
    if (limited) return limited;
  }

  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();

  if (PUBLIC_PREFIXES.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Bearer auth is resolved in the handler. A cookie check here would 401
  // every plugin call before `requireV1User` could look at the token.
  // `/api/storage` is the local driver's signed URL; the plugin fetches it
  // with the same PAT.
  if (pathname.startsWith("/api/v1") || pathname.startsWith("/api/storage")) {
    return NextResponse.next();
  }

  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  if (hasSession) return NextResponse.next();

  // API routes get a 401 they can render an error from, rather than an HTML
  // redirect that `fetch()` would follow and then fail to parse as JSON.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "sign in to continue" }, { status: 401 });
  }

  const target = new URL("/sign-in", request.url);
  target.searchParams.set("next", pathname);

  return NextResponse.redirect(target);
}

export const config = {
  // Node rather than edge, so `limiter` is ordinary memory in the server
  // process instead of state in a sandbox that may be recycled.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
