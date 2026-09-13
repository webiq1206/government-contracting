import type { Metadata } from "next";
import Link from "next/link";
import { MarketingShell, PageIntro } from "@/components/marketing/site-shell";
import {
  HOME_SECTIONS,
  PUBLIC_ROUTES,
  absoluteUrl,
  type RouteGroup,
} from "@/lib/domain/public-routes";
export const metadata: Metadata = {
  title: "Site map",
  description:
    "Find BrostCo product information, AI workflows, demos, pricing, setup, and company information.",
  alternates: { canonical: "/sitemap" },
};
const SITE_URL = process.env.APP_URL || "https://brostco.com";
const GROUPS: RouteGroup[] = [
  "Product",
  "Get started",
  "Company",
  "Legal",
  "Reference",
];
export default function SiteMapPage() {
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "BrostCo site map",
    numberOfItems: PUBLIC_ROUTES.length,
    itemListElement: PUBLIC_ROUTES.map((route, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: route.label,
      item: absoluteUrl(SITE_URL, route.path),
    })),
  };
  return (
    <MarketingShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <PageIntro
        eyebrow="Site map"
        title="Find your way around BrostCo."
        copy="Explore the product, see how AI fits the workflow, understand costs, or get ready for your first trial."
      />
      <div className="bco-container bco-section">
        <div className="bco-directory">
          {GROUPS.map((group) => (
            <section key={group}>
              <h2>{group}</h2>
              <ul>
                {PUBLIC_ROUTES.filter((route) => route.group === group).map(
                  (route) => (
                    <li key={route.path}>
                      <Link href={route.path}>{route.label} ↗</Link>
                      <p>{route.summary}</p>
                    </li>
                  ),
                )}
              </ul>
            </section>
          ))}
          <section>
            <h2>On the homepage</h2>
            <ul>
              {HOME_SECTIONS.map((section) => (
                <li key={section.hash}>
                  <Link href={`/${section.hash}`}>{section.label} ↗</Link>
                  <p>{section.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <div className="bco-subnav">
          <Link href="/login">Log in</Link>
          <a href="/sitemap.xml">XML sitemap</a>
          <a href="/llms.txt">AI-readable overview</a>
          <a href="/robots.txt">Crawl rules</a>
        </div>
      </div>
    </MarketingShell>
  );
}
