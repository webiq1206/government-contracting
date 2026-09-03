import type { MetadataRoute } from "next";
import { PUBLIC_ROUTES, absoluteUrl } from "@/lib/domain/public-routes";

/**
 * Read per request, not baked into the build.
 *
 * This route was statically prerendered, which meant the host came from
 * whatever APP_URL happened to be set when `next build` ran. A build without
 * it produces a sitemap that tells Google the site lives at
 * `http://localhost:3000`, and nothing about that failure is visible: the file
 * is well-formed, the build is green, and the only symptom is that search
 * engines are being handed addresses that do not resolve. `force-dynamic`
 * costs nothing here -- this is a handful of URLs served to crawlers, not a
 * hot user path -- and it removes a silent, total failure mode.
 */
export const dynamic = "force-dynamic";

/**
 * When this deployment went out.
 *
 * Captured once at module load rather than per request. `lastModified` is a
 * claim about when the page changed, and these pages change when they are
 * deployed; answering with the current time would tell a crawler the whole
 * site changed every time it asked, which is the fastest way to teach it to
 * ignore the field.
 */
const DEPLOYED_AT = new Date();

/**
 * /sitemap.xml, generated from the declared public surface.
 *
 * It was four URLs written out by hand, which is fine until somebody adds a
 * public page and nothing tells the sitemap. The list now comes from
 * `lib/domain/public-routes.ts`, which robots.txt, the HTML site map at
 * /sitemap and /llms.txt also read, so a page reaches all four or none.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.APP_URL || "https://brostco.com";
  return PUBLIC_ROUTES.map((route) => ({
    url: absoluteUrl(siteUrl, route.path),
    lastModified: DEPLOYED_AT,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
