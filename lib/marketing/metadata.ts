import type { Metadata } from "next";

/** One title, description and canonical for search and social previews. */
export function publicMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website", siteName: "BrostCo", title: `${title} | BrostCo`,
      description, url: path,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "BrostCo: AI for government contractors" }],
    },
    twitter: { card: "summary_large_image", title: `${title} | BrostCo`, description, images: ["/og.png"] },
  };
}
