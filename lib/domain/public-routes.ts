/**
 * The public surface of this site, declared once.
 *
 * Four things need to agree about which pages a crawler may have: the XML
 * sitemap, robots.txt, the HTML sitemap page, and llms.txt. They did not.
 * `app/sitemap.ts` carried a hand-written list of four URLs and
 * `app/robots.ts` a hand-written list of thirteen disallowed prefixes, and the
 * app had grown to sixty-three page routes underneath both of them. Twenty-one
 * signed-in routes were absent from the disallow list, `/admin` and the
 * `/theme-qa` developer harness among them, and nothing anywhere would have
 * noticed a new public page never reaching the sitemap.
 *
 * So this module is the source, and all four read from it.
 *
 * Deliberately a declaration rather than a filesystem scan. Scanning
 * `app/**\/page.tsx` would be "live" in the wrong sense: it cannot tell a
 * marketing page from an auth-gated one, and defaulting either way is a
 * mistake with a real cost -- either the sitemap advertises the whole
 * application, or a genuinely public page silently never appears. What keeps
 * this honest instead is `tests/public-routes.test.ts`, which walks the app
 * directory and fails when a route is neither declared public here nor
 * covered by a disallow rule. A new page cannot be added without this file
 * being brought along.
 *
 * Pure. No imports.
 */

export type RouteGroup = "Product" | "Get started" | "Legal" | "Reference";

export interface PublicRoute {
  /** Absolute path, no host, no trailing slash except the root. */
  path: string;
  /** Link text on the HTML sitemap. */
  label: string;
  /** One line saying what the page is for. Used on the sitemap and llms.txt. */
  summary: string;
  changeFrequency: "weekly" | "monthly" | "yearly";
  /** Relative to the rest of this list, which is all a priority means. */
  priority: number;
  group: RouteGroup;
}

/**
 * Every page a crawler is welcome to index, in the order a person would meet
 * them.
 */
export const PUBLIC_ROUTES: PublicRoute[] = [
  {
    path: "/",
    label: "Home",
    summary:
      "What Brost Co does: watches SAM.gov for matching work, scores each opportunity, sources and emails subcontractors, and prepares the bid package. Includes pricing, the workflow, a product film, and answers to common questions.",
    changeFrequency: "weekly",
    priority: 1,
    group: "Product",
  },
  {
    path: "/signup",
    label: "Start a free trial",
    summary:
      "Create an account. Every plan starts with a free 7-day trial that needs no credit card, and nothing is charged unless a plan is chosen before the trial ends.",
    changeFrequency: "weekly",
    priority: 0.9,
    group: "Get started",
  },
  {
    path: "/compare",
    label: "Compare the four approaches",
    summary:
      "The four ways a federal services contractor runs its bid pipeline -- spreadsheets, a general CRM, a bid alert feed, or hiring a capture person -- what each covers, where each breaks, and who each is genuinely the right answer for.",
    changeFrequency: "monthly",
    priority: 0.8,
    group: "Product",
  },
  {
    path: "/pricing-guide",
    label: "Pricing explained",
    summary:
      "What Brost Co costs monthly and annually, what the free trial includes, which API keys you supply yourself after it, and how to work out whether it pays for itself on your bid volume.",
    changeFrequency: "monthly",
    priority: 0.8,
    group: "Product",
  },
  {
    path: "/sitemap",
    label: "Site map",
    summary:
      "Every public page on this site in one list, with a line on what each is for. The same list is served as /sitemap.xml for search crawlers and /llms.txt for AI answer engines.",
    changeFrequency: "monthly",
    priority: 0.2,
    group: "Reference",
  },
  {
    path: "/privacy",
    label: "Privacy Policy",
    summary:
      "What Brost Co collects, how it is used, who processes it, and how long it is kept.",
    changeFrequency: "yearly",
    priority: 0.3,
    group: "Legal",
  },
  {
    path: "/terms",
    label: "Terms of Service",
    summary: "The agreement covering use of the Brost Co application.",
    changeFrequency: "yearly",
    priority: 0.3,
    group: "Legal",
  },
];

/**
 * Sections of the home page worth their own entry on the HTML sitemap.
 *
 * Not sitemap.xml entries: a fragment is the same document to a crawler, and
 * listing four of them as separate URLs would claim four pages where there is
 * one. They earn a place on the HTML sitemap because a person scanning for
 * "pricing" wants a link that lands on pricing.
 */
export const HOME_SECTIONS: { hash: string; label: string; summary: string }[] = [
  { hash: "#platform", label: "Platform", summary: "What the software does, part by part." },
  { hash: "#pipeline", label: "Pipeline", summary: "How work moves from a posting to a submitted bid." },
  { hash: "#see-it", label: "Product film", summary: "One minute of the real dashboard, captioned." },
  { hash: "#pricing", label: "Pricing", summary: "What it costs, and what the trial includes." },
  { hash: "#faq", label: "Questions and answers", summary: "What it is, what it does not do, and who it is for." },
];

/**
 * Path prefixes no crawler should request, each with the reason.
 *
 * The reason is not decoration. Every one of these is either behind
 * authentication, a signed-out utility page with nothing to index, a
 * token-bearing URL, or a developer surface, and knowing which decides what
 * happens when somebody adds a route next to it.
 */
export const DISALLOWED_PREFIXES: { prefix: string; why: string }[] = [
  // The signed-in application. A crawler that requests these is redirected to
  // the login page, which spends crawl budget to arrive nowhere.
  { prefix: "/today", why: "Signed-in application." },
  { prefix: "/workbench", why: "Signed-in application." },
  { prefix: "/pipeline", why: "Signed-in application." },
  { prefix: "/opportunities", why: "Signed-in application." },
  { prefix: "/opportunity", why: "Signed-in application, per-record." },
  { prefix: "/review", why: "Signed-in application." },
  { prefix: "/call-queue", why: "Signed-in application." },
  { prefix: "/communications", why: "Signed-in application." },
  { prefix: "/email-log", why: "Signed-in application." },
  { prefix: "/subs", why: "Signed-in application, per-record." },
  { prefix: "/contracts", why: "Signed-in application, per-record." },
  { prefix: "/compliance", why: "Signed-in application." },
  { prefix: "/authority", why: "Signed-in application." },
  { prefix: "/analytics", why: "Signed-in application." },
  { prefix: "/agents", why: "Signed-in application." },
  { prefix: "/automation", why: "Signed-in application." },
  { prefix: "/recap", why: "Signed-in application." },
  { prefix: "/search", why: "Signed-in application." },
  { prefix: "/more", why: "Signed-in application." },
  { prefix: "/feedback", why: "Signed-in application." },
  { prefix: "/how-it-works", why: "Signed-in help page." },
  { prefix: "/settings", why: "Signed-in application." },
  { prefix: "/admin", why: "Platform administration." },
  { prefix: "/billing/", why: "Post-checkout confirmation; needs a live Stripe session." },

  // Signed-out utility pages. Nothing to index, and indexing a password reset
  // form serves nobody.
  { prefix: "/login", why: "Signed-out utility page." },
  { prefix: "/setup", why: "Signed-out, and only reachable on a fresh install." },
  { prefix: "/forgot-password", why: "Signed-out utility page." },
  { prefix: "/reset-password", why: "Signed-out, and needs a live token." },
  { prefix: "/invite", why: "Signed-out, and needs a live invitation token." },

  // Token-bearing URLs. Both also send noindex on the page itself; this keeps
  // a crawler from requesting them at all.
  { prefix: "/vendor/", why: "The subcontractor's own upload page, reached by token." },
  { prefix: "/d/", why: "Signed document links, reached by token." },

  // Not pages.
  { prefix: "/api/", why: "JSON endpoints." },
  { prefix: "/theme-qa", why: "A palette harness for developers, not a product page." },
];

export type Crawlability = "public" | "disallowed" | "unclassified";

/**
 * Whether a route may be crawled, or is not covered either way.
 *
 * `unclassified` is the answer that matters: it means somebody added a page
 * and neither list knows about it, which is the state both hand-written lists
 * were in. The test treats it as a failure.
 */
export function crawlability(route: string): Crawlability {
  if (PUBLIC_ROUTES.some((r) => r.path === route)) return "public";
  if (DISALLOWED_PREFIXES.some((d) => route === d.prefix || route.startsWith(d.prefix))) {
    return "disallowed";
  }
  return "unclassified";
}

/**
 * AI answer-engine crawlers, named one at a time.
 *
 * Leaving these to `User-agent: *` is not the same as allowing them. Where a
 * wildcard block reads as restrictive, a cautious crawler can decline to
 * fetch at all, and the site is then absent from AI answers however well the
 * pages are written. Naming each one and allowing the public surface removes
 * the ambiguity.
 *
 * To opt out of AI training or AI answers, move a name out of this list and
 * disallow it explicitly rather than deleting it, so the choice is visible.
 */
export const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
] as const;

/** The paths robots.txt allows: the public surface, and nothing else. */
export function allowedPaths(): string[] {
  return PUBLIC_ROUTES.map((r) => r.path);
}

/** The prefixes robots.txt disallows. */
export function disallowedPaths(): string[] {
  return DISALLOWED_PREFIXES.map((d) => d.prefix);
}

/** Absolute URL for a public path, given the site's origin. */
export function absoluteUrl(siteUrl: string, path: string): string {
  const origin = siteUrl.replace(/\/+$/, "");
  return path === "/" ? origin : `${origin}${path}`;
}
