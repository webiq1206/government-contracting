import { NextResponse, type NextRequest } from "next/server";
import { PUBLIC_ROUTES } from "@/lib/domain/public-routes";

/*
 * The crawlable pages, from the one declaration.
 *
 * These were listed here by hand as well, which made this the fifth copy of
 * "what is public" -- after the XML sitemap, robots.txt, the HTML site map and
 * llms.txt -- and the one whose disagreement is worst. A page missing from the
 * others is merely not advertised; a page missing from here is advertised in
 * the sitemap and then redirects the crawler to the login form. Deriving it
 * means a page cannot be published and unreachable at the same time.
 *
 * Not the whole list: plenty of paths must be reachable without a session
 * without being indexable -- the login form, the invitation flow, the
 * subcontractor portal, the webhook endpoints. Those stay below, because
 * "reachable" and "crawlable" are different questions with different answers.
 */
const CRAWLABLE_PATHS = PUBLIC_ROUTES.map((r) => r.path);

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
  "/setup",
  "/forgot-password",
  "/reset-password",
  // Accepting an invitation. The person following the link has no account yet
  // by definition, so bouncing them to the login page would make every
  // invitation we send a dead end.
  "/invite",
  "/api/invitations",
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
    // Machine-readable, and served to readers that never sign in.
    pathname === "/llms.txt" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/og.png" ||
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return true;
  }
  if (CRAWLABLE_PATHS.includes(pathname)) return true;
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
