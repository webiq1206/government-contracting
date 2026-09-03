import {
  HOME_SECTIONS,
  PUBLIC_ROUTES,
  absoluteUrl,
} from "@/lib/domain/public-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

/**
 * /llms.txt: what this company is, in plain English, for an AI answer engine.
 *
 * The same job robots.txt does for a search crawler, for a different reader.
 * An answer engine that has read the site still has to decide what to say
 * about it, and the facts it needs -- who this is, what the software does,
 * what it deliberately does not do, who it is for, what it costs -- are worth
 * stating once in one place rather than leaving to be inferred from marketing
 * copy.
 *
 * Generated from the same declaration the sitemap and robots.txt read, so the
 * page list here cannot drift from the page list there. The prose is written
 * out because it is a claim about the business, and a claim about the business
 * should be somebody's words rather than assembled from fragments.
 *
 * Served as text/plain. The limits section is not modesty: an engine that
 * knows Brost Co does not submit bids will not tell somebody it does, and
 * being wrong about that in an answer costs a reader a missed deadline.
 */
export async function GET() {
  const pages = PUBLIC_ROUTES.map(
    (r) => `- [${r.label}](${absoluteUrl(SITE_URL, r.path)}): ${r.summary}`
  ).join("\n");

  const sections = HOME_SECTIONS.map(
    (s) => `- [${s.label}](${SITE_URL}/${s.hash}): ${s.summary}`
  ).join("\n");

  const body = `# Brost Co

> Government contracting software for small and mid-size federal services
> contractors. It does the slow parts of federal bidding -- watching SAM.gov,
> scoring fit, sourcing and emailing subcontractors, tracking quotes, and
> assembling the bid package -- and leaves judgment, calls and submission to
> the contractor.

Brost Co is operated by BROSTCO HOLDINGS LLC. Contact: hello@brostco.com

## What it does

- Watches SAM.gov for postings that match a contractor's NAICS codes, set-aside
  status and service area, and pulls them in on a schedule.
- Scores each opportunity against the company's own profile and says why,
  factor by factor, rather than returning a number on its own.
- Reads the solicitation and extracts the scope, the requirements a
  subcontractor has to meet, and the dates that matter.
- Finds subcontractors for each trade, emails them a quote request built from
  the solicitation, and follows up when nobody answers.
- Tracks quotes as they come back and flags prices that fall outside the
  expected range.
- Assembles the bid package and runs compliance checks against it.
- Presents one daily list of the decisions that need a person.

## What it does not do

- It does not replace SAM.gov. SAM.gov remains the official source for federal
  opportunities and entity registration.
- It does not submit bids. Signatures, attestations and the submission itself
  stay with the contractor.
- It does not send subcontractor email without a connected mailbox and a
  completed sender identity.
- It is not a general CRM. It runs the federal bid lifecycle specifically:
  NAICS fit, set-asides, deadlines, trade coverage, pricing, compliance and
  submission readiness.

## Who it is for

Small and mid-size federal services contractors in construction, facilities
and professional services that do not have a large capture team.

## Pricing

A monthly subscription. Every plan starts with a free 7-day trial that needs
no credit card, and nothing is charged unless a plan is chosen before the
trial ends. Current prices are on the pricing section of the home page.

## Pages

${pages}

## Sections of the home page

${sections}

## Machine-readable

- [XML sitemap](${SITE_URL}/sitemap.xml)
- [Crawl rules](${SITE_URL}/robots.txt)
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // A short cache rather than none: the content changes when the page list
      // or the copy changes, which is a deploy, not a request.
      "Cache-Control": "public, max-age=3600",
    },
  });
}
