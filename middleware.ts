import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Bounces unauthenticated page requests to sign-in.
 *
 * Checks for the session cookie rather than calling `auth()`: middleware runs
 * on the edge runtime, where the database adapter cannot, and a cookie check
 * is enough for a redirect. It is not enough for authorization -- that is
 * `requireUser` and `requireMember`, which run in the handler against the
 * session table. A forged cookie gets you a page shell and a 401 from every
 * request it makes.
 */
const PUBLIC_PREFIXES = ["/sign-in", "/api/auth", "/api/health"];

/**
 * Public pages, matched exactly rather than by prefix -- `/` as a prefix
 * would make the entire app public, which is the kind of mistake that only
 * shows up in production.
 */
const PUBLIC_PAGES = new Set(["/", "/privacy", "/terms"]);

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();

  if (PUBLIC_PREFIXES.some((path) => pathname.startsWith(path))) {
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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
