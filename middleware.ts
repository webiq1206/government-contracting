import { NextResponse, type NextRequest } from "next/server";

/**
 * Lightweight edge guard: send anonymous users away from the app shell, and
 * send signed-in users visiting marketing home toward Today. Subscription
 * entitlement is enforced in the dash layout (needs DB).
 */
const PUBLIC_PREFIXES = [
  "/",
  "/login",
  "/signup",
  "/setup",
  "/forgot-password",
  "/reset-password",
  "/privacy",
  "/terms",
  "/billing/success",
  "/api/auth",
  "/api/billing/webhook",
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
    pathname.endsWith(".png") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return true;
  }
  return PUBLIC_PREFIXES.some(
    (p) => p !== "/" && (pathname === p || pathname.startsWith(p + "/"))
  );
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = req.cookies.get("brostco_session")?.value;

  if (pathname === "/" && session) {
    return NextResponse.redirect(new URL("/today", req.url));
  }

  if (!isPublic(pathname) && !session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
