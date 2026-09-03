import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/marketing-footer";
import {
  HOME_SECTIONS,
  PUBLIC_ROUTES,
  absoluteUrl,
  type RouteGroup,
} from "@/lib/domain/public-routes";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

export const metadata: Metadata = {
  title: "Site Map | Every Page on Brost Co",
  description:
    "Every public page on brostco.com in one list: the platform, the pipeline, pricing, the product film, questions and answers, signup, privacy and terms.",
  alternates: { canonical: "/sitemap" },
  openGraph: {
    title: "Site Map | Every Page on Brost Co",
    description:
      "Every public page on brostco.com in one list, with a line on what each one is for.",
    url: `${SITE_URL}/sitemap`,
    type: "website",
    siteName: "Brost Co",
  },
  twitter: {
    card: "summary",
    title: "Site Map | Every Page on Brost Co",
    description: "Every public page on brostco.com in one list.",
  },
};

const GROUP_ORDER: RouteGroup[] = ["Product", "Get started", "Legal", "Reference"];

const GROUP_BLURB: Record<RouteGroup, string> = {
  Product: "What the software does, and how a bid moves through it.",
  "Get started": "Opening an account and starting the trial.",
  Legal: "The agreement and the privacy terms.",
  Reference: "This page, and the machine-readable copies of it.",
};

/**
 * The HTML site map: a real crawl path, not a picture of one.
 *
 * Two properties make it that, and both are why the list is generated rather
 * than typed out here.
 *
 * Every entry is a plain `<a href>` in the server-rendered HTML. A crawler
 * that runs no JavaScript -- which most AI answer-engine crawlers do not --
 * gets the whole list from the first response. Nothing here is fetched, and
 * nothing appears only after hydration.
 *
 * And the list is the same one `/sitemap.xml`, `/robots.txt` and `/llms.txt`
 * read, from `lib/domain/public-routes.ts`. A page cannot be public in the XML
 * sitemap and missing from this page, which is the state a hand-maintained
 * HTML sitemap always drifts into: it is the copy nobody remembers to update,
 * and a stale one actively misleads, pointing crawlers and people at pages
 * that have moved or gone.
 *
 * There is no FAQ block on this page. The standard asks for one where a page
 * could answer a question, and a directory of four links is not that page;
 * inventing questions for it would be the padding the standard warns against.
 * The direct-answer paragraph below is the part that genuinely applies.
 */
export default function SiteMapPage() {
  const sectionsOfHome = HOME_SECTIONS;

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Brost Co site map",
    description: "Every public page on brostco.com.",
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    numberOfItems: PUBLIC_ROUTES.length,
    itemListElement: PUBLIC_ROUTES.map((route, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: route.label,
      description: route.summary,
      item: absoluteUrl(SITE_URL, route.path),
    })),
  };

  const webpage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "@id": `${SITE_URL}/sitemap#webpage`,
    name: "Site Map | Every Page on Brost Co",
    url: `${SITE_URL}/sitemap`,
    description:
      "Every public page on brostco.com in one list, with a line on what each one is for.",
    isPartOf: { "@type": "WebSite", name: "Brost Co", url: SITE_URL },
    about: { "@id": `${SITE_URL}/#organization` },
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Site map", item: `${SITE_URL}/sitemap` },
    ],
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webpage) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemList) }}
      />

      <MarketingNav loginHref="/login" signupHref="/signup" />

      <main className="mx-auto max-w-3xl px-5 py-16">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/" className="hover:text-foreground">
            Home
          </Link>
          <span aria-hidden> / </span>
          <span aria-current="page">Site map</span>
        </nav>

        <p className="eyebrow mt-6">Site map</p>
        <h1 className="mt-2 font-display text-4xl text-foreground">
          Every page on Brost Co
        </h1>

        {/*
          * The direct answer, before anything else.
          *
          * Somebody arriving here wants to know what this site contains and
          * where to go, and an answer engine quoting this page wants one
          * self-contained paragraph it can lift. Both are served by saying it
          * plainly in the first block rather than after a preamble.
          */}
        <p className="mt-5 text-base leading-relaxed text-slate-700">
          Brost Co is government contracting software for small and mid-size federal
          services contractors. The public site has {PUBLIC_ROUTES.length} pages:{" "}
          {PUBLIC_ROUTES.map((r) => r.label).join(", ")}. The home page carries the
          platform, the bid pipeline, pricing and a product film. The software itself
          sits behind a login and is not part of this list.
        </p>

        {GROUP_ORDER.map((group) => {
          const routes = PUBLIC_ROUTES.filter((r) => r.group === group);
          if (routes.length === 0) return null;
          return (
            <section key={group} className="mt-10">
              <h2 className="font-display text-2xl text-foreground">{group}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{GROUP_BLURB[group]}</p>
              <ul className="mt-4 space-y-4">
                {routes.map((route) => (
                  <li key={route.path}>
                    <Link
                      href={route.path}
                      className="font-medium text-foreground underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
                    >
                      {route.label}
                    </Link>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">
                      {route.summary}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <section className="mt-10">
          <h2 className="font-display text-2xl text-foreground">
            What is on the home page?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Sections of the home page, for going straight to one. These are parts of that
            page rather than pages of their own, which is why they are not listed as
            separate addresses in the XML sitemap.
          </p>
          <ul className="mt-4 space-y-4">
            {sectionsOfHome.map((s) => (
              <li key={s.hash}>
                <Link
                  href={`/${s.hash}`}
                  className="font-medium text-foreground underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
                >
                  {s.label}
                </Link>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">{s.summary}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 border-t border-border pt-6">
          <h2 className="font-display text-2xl text-foreground">
            Where are the machine-readable versions?
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            The same list is served as{" "}
            <a
              href="/sitemap.xml"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              /sitemap.xml
            </a>{" "}
            for search crawlers and as{" "}
            <a
              href="/llms.txt"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              /llms.txt
            </a>{" "}
            for AI answer engines.{" "}
            <a
              href="/robots.txt"
              className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
            >
              /robots.txt
            </a>{" "}
            says which paths may be requested. All four are generated from one
            declaration, so they cannot disagree.
          </p>
        </section>

        <p className="mt-10 text-sm text-slate-600">
          Looking for the software rather than the site?{" "}
          <Link
            href="/signup"
            className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
          >
            Start a free trial
          </Link>{" "}
          or{" "}
          <Link
            href="/login"
            className="underline decoration-gold/60 underline-offset-4 hover:text-gold-text"
          >
            sign in
          </Link>
          .
        </p>
      </main>

      <MarketingFooter loginHref="/login" />
    </div>
  );
}
