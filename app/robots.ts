import type { MetadataRoute } from "next";
import {
  AI_CRAWLERS,
  allowedPaths,
  disallowedPaths,
} from "@/lib/domain/public-routes";

/**
 * Read per request, for the same reason as the sitemap: prerendering baked the
 * host from the build environment, and a build without APP_URL would point
 * every crawler at the sitemap of a machine that is not this one.
 */
export const dynamic = "force-dynamic";

/**
 * /robots.txt, generated from the declared public surface.
 *
 * Two things were wrong with the hand-written version.
 *
 * Its disallow list had thirteen prefixes while the application had grown to
 * sixty-three page routes. Twenty-one signed-in routes were missing from it,
 * including all of /admin and the /theme-qa developer harness, so a crawler
 * was free to request them, be redirected to the login page, and spend its
 * budget arriving nowhere. The list now comes from
 * `lib/domain/public-routes.ts`, where a test fails if a route is neither
 * declared public nor covered by a rule.
 *
 * And it left AI answer engines to the wildcard block, which is not the same
 * as allowing them: where a wildcard reads as restrictive, a cautious crawler
 * can decline to fetch at all. Each one is now named and allowed the same
 * public surface.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.APP_URL || "https://brostco.com";
  const allow = allowedPaths();
  const disallow = disallowedPaths();

  return {
    rules: [
      { userAgent: "*", allow, disallow },
      // Named individually rather than as one grouped rule, so a decision to
      // opt a single engine out is a one-line change that stays readable.
      ...AI_CRAWLERS.map((userAgent) => ({ userAgent, allow, disallow })),
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
