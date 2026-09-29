import { HOME_FAQ, TRIAL_COPY, USAGE_COPY } from "./site-content";
import {
  ORGANIZATION_ALTERNATE_NAMES,
  ORGANIZATION_NAME,
  jsonLdGraph,
  jsonLdString,
  organizationId,
  organizationRef,
  organizationSchema,
  siteImage,
  siteUrl,
} from "@/lib/marketing/schema";

/**
 * The home page's structured data: who the company is, what the software is
 * and costs, the site itself, and the questions answered on the page.
 *
 * One graph rather than four separate scripts, so the WebSite and the
 * SoftwareApplication can point at the same Organization by `@id`. FAQPage
 * stays although Google no longer shows FAQ rich results: the markup is valid
 * schema.org, it mirrors the visible questions word for word, and answer
 * engines still read it.
 */
export function JsonLd({
  promoActive,
  foundingMonthly,
  standardMonthly,
  promoEndsAt,
}: {
  promoActive: boolean;
  foundingMonthly: number;
  standardMonthly: number;
  promoEndsAt: string | null;
}) {
  const site = siteUrl();
  const data = jsonLdGraph([
    organizationSchema(site),
    {
      "@type": "WebSite",
      "@id": `${site}/#website`,
      name: ORGANIZATION_NAME,
      alternateName: [...ORGANIZATION_ALTERNATE_NAMES],
      url: site,
      inLanguage: "en-US",
      publisher: { "@id": organizationId(site) },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${site}/#software`,
      name: ORGANIZATION_NAME,
      applicationCategory: "BusinessApplication",
      applicationSubCategory: "Government contracting software",
      operatingSystem: "Web",
      url: site,
      image: siteImage(site),
      description:
        "AI for government contractors: opportunity discovery, requirement analysis, subcontractor coordination, and bid preparation. Your team reviews and submits.",
      featureList: [
        "SAM.gov opportunity discovery scored against a company profile",
        "Solicitation analysis: scope, requirements, dates and risk flags",
        "Subcontractor search, outreach and quote tracking through a connected mailbox",
        "Bid package preparation with pricing and compliance checks for human review",
        "Daily action list of decisions that need a person",
      ],
      publisher: organizationRef(site),
      offers: {
        "@type": "Offer",
        name: promoActive ? "Founding monthly" : "Standard monthly",
        price: String(promoActive ? foundingMonthly : standardMonthly),
        priceCurrency: "USD",
        description: `${TRIAL_COPY} ${USAGE_COPY}`,
        url: `${site}/pricing-guide`,
        ...(promoActive && promoEndsAt ? { priceValidUntil: promoEndsAt } : {}),
      },
    },
    {
      "@type": "FAQPage",
      mainEntity: HOME_FAQ.map(([name, text]) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
  ]);
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdString(data) }}
    />
  );
}
