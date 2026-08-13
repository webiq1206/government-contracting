import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight edge guard: keep marketing and auth routes public, and send
 * anonymous users away from the app shell. Subscription entitlement is
 * enforced in the dash layout (needs DB).
 *
 * Important: `/` must stay public for everyone, including visitors with a
 * stale session cookie. Do not bounce `/` into the dash here; a bad cookie
 * would then hit the dash auth gate and look like "the landing page always
 * redirects to /login".
 */
const PUBLIC_PREFIXES = [
  "/login",
  "/signup",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/billing/success",
  "/settings/billing",
  "/theme-qa",
  // Landing product film (video, poster, captions) — served to anonymous
  // visitors on `/`, so it must never be bounced to the login page.
  "/film",
  // Subcontractor paperwork portal. Public for the same reason /d/ is: the
  // subcontractor has no account and never will. Authorization is the signed,
  // expiring token in the URL, checked inside the route.
  "/vendor",
  "/api/vendor",
  "/api/auth",
  "/api/billing",
  "/api/health",
  "/api/track",
  "/api/webhooks",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/") return true;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/brand") ||
    pathname.startsWith("/favicon") ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/og.png" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return true;
  }
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/")
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const session = req.cookies.get("brostco_session")?.value;
  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  // Explicitly include `/` so the marketing home is never skipped by the
  // catch-all pattern on some Next.js matcher implementations.
  matcher: ["/", "/((?!_next/static|_next/image).*)"],
};
