import Link from "next/link";
import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";
import { TRIAL_COPY } from "./site-content";
import { StickyColumn } from "./sticky-column";
import { SectionReveals } from "./section-reveals";
import "./site.css";
import { breadcrumbSchema, jsonLdGraph, jsonLdString, type Crumb } from "@/lib/marketing/schema";

export function MarketingShell({
  children,
  signupHref = "/signup",
  darkHeader = false,
}: {
  children: React.ReactNode;
  signupHref?: string;
  darkHeader?: boolean;
}) {
  return (
    <div className={`bco-site${darkHeader ? " bco-site-landing" : ""}`}>
      <SectionReveals />
      <a className="bco-skip" href="#main-content">
        Skip to content
      </a>
      <MarketingNav
        signupHref={signupHref}
        variant={darkHeader ? "dark" : "light"}
      />
      <main id="main-content">{children}</main>
      <MarketingFooter />
    </div>
  );
}
export function PageIntro({
  eyebrow,
  title,
  copy,
  path,
  parent,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  /**
   * The page's own path. When given, the visible breadcrumb is also emitted
   * as BreadcrumbList structured data, so the trail a visitor sees is the
   * trail a search engine is told about, and nothing more.
   */
  path?: string;
  /** An intermediate crumb between Home and this page, for nested pages. */
  parent?: { label: string; href: string };
}) {
  const crumbs: Crumb[] = [
    { name: "Home", path: "/" },
    ...(parent ? [{ name: parent.label, path: parent.href }] : []),
    // The visible trail ends in the section name for a top-level page and in
    // the page title for a nested one, so the markup does the same.
    ...(path ? [{ name: parent ? title : eyebrow, path }] : []),
  ];
  return (
    <section className="bco-container bco-page-intro">
      {path && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(jsonLdGraph([breadcrumbSchema(crumbs)])) }}
        />
      )}
      <nav className="bco-breadcrumb" aria-label="Breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        {parent && (
          <>
            <Link href={parent.href}>{parent.label}</Link>
            <span aria-hidden="true">/</span>
          </>
        )}
        <span aria-current="page">{parent ? title : eyebrow}</span>
      </nav>
      <p className="bco-kicker">{eyebrow}</p>
      <h1>{title}</h1>
      <p className="bco-lead">{copy}</p>
    </section>
  );
}
export function SectionHeading({
  eyebrow,
  title,
  children,
  sticky = false,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
  sticky?: boolean;
}) {
  const content = (
    <div className="bco-section-heading">
      {eyebrow && <p className="bco-kicker">{eyebrow}</p>}
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
  return sticky ? <StickyColumn>{content}</StickyColumn> : content;
}
export function TrialCTA({
  signupHref = "/signup",
  title = "Put AI to work on your next bid.",
}: {
  signupHref?: string;
  title?: string;
}) {
  return (
    <section className="bco-container bco-final-cta">
      <div>
        <p className="bco-kicker">Your next step</p>
        <h2>{title}</h2>
        <p>
          Create your company profile, connect the services you need, and review
          a real opportunity.
        </p>
        <p className="bco-caption">{TRIAL_COPY}</p>
      </div>
      <div className="bco-actions">
        <Link href={signupHref} className="bco-button">
          Start free trial <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/demo" className="bco-button bco-button-secondary">
          Explore the product
        </Link>
      </div>
    </section>
  );
}
export function FAQ({
  items,
}: {
  items: readonly (readonly [string, string])[];
}) {
  return (
    <div className="bco-faq">
      {items.map(([question, answer]) => (
        <details key={question}>
          <summary>
            {question}
            <span aria-hidden="true">+</span>
          </summary>
          <p>{answer}</p>
        </details>
      ))}
    </div>
  );
}
export function ProductIcon({
  kind = "spark",
}: {
  kind?: "spark" | "source" | "people" | "check" | "clock" | "shield";
}) {
  const paths = {
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
        <path d="M20 2v4M18 4h4" />
      </>
    ),
    source: (
      <>
        <path d="M7 3h8l4 4v14H5V3h2ZM14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    people: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2" />
      </>
    ),
    check: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
  };
  return (
    <span className="bco-icon">
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {paths[kind]}
      </svg>
    </span>
  );
}
