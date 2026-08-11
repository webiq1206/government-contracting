import type { MetadataRoute } from "next";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/privacy", "/terms", "/signup"],
        disallow: [
          "/today",
          "/pipeline",
          "/opportunity",
          "/subs",
          "/settings",
          "/api/",
          "/call-queue",
          "/agents",
          "/login",
          "/setup",
          "/billing/",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
