const SITE_URL = process.env.APP_URL || "https://brostco.com";

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
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Brost Co",
    legalName: "BROSTCO HOLDINGS LLC",
    url: SITE_URL,
    logo: `${SITE_URL}/brand/b-mark.png`,
    image: `${SITE_URL}/opengraph-image`,
    email: "hello@brostco.com",
    description:
      "Brost Co is procurement execution software for federal services contractors. It finds, scores, sources, and prepares government contract opportunities.",
  };

  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Brost Co | Procurement Execution for Federal Contractors",
    url: SITE_URL,
    description:
      "Win the right government contracts. Brost Co finds, scores, sources, and prepares opportunities so you stop managing the process by hand.",
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: `${SITE_URL}/opengraph-image`,
      width: 1200,
      height: 630,
    },
    isPartOf: { "@type": "WebSite", name: "Brost Co", url: SITE_URL },
    about: { "@id": `${SITE_URL}/#organization` },
  };

  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Brost Co",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "Government contracting software for opportunity discovery, scoring, subcontractor sourcing, quote tracking, and bid preparation.",
    offers: promoActive
      ? [
          {
            "@type": "Offer",
            name: "Founding customer monthly",
            price: String(foundingMonthly),
            priceCurrency: "USD",
            category: "Subscription",
            description:
              "Limited founding rate locked for the life of an active subscription.",
            priceValidUntil: promoEndsAt ?? undefined,
            url: `${SITE_URL}/signup?plan=founding`,
          },
          {
            "@type": "Offer",
            name: "Standard monthly",
            price: String(standardMonthly),
            priceCurrency: "USD",
            category: "Subscription",
            url: `${SITE_URL}/signup?plan=standard`,
          },
        ]
      : [
          {
            "@type": "Offer",
            name: "Standard monthly",
            price: String(standardMonthly),
            priceCurrency: "USD",
            category: "Subscription",
            url: `${SITE_URL}/signup?plan=standard`,
          },
        ],
  };

  const pricingAnswer = promoActive
    ? `Standard pricing is $${standardMonthly} per month. Founding customers who join during the launch window lock in $${foundingMonthly} per month for as long as they remain subscribed.`
    : `Brost Co is $${standardMonthly} per month.`;

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Brost Co?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co is procurement execution software for federal services contractors. It monitors SAM.gov, evaluates opportunities against your business, helps source subcontractors, prepares bid packages, and gives your team one prioritized list of work that needs attention.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co replace SAM.gov?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. SAM.gov remains the official source for federal opportunities and entity registration. Brost Co organizes and advances the work after opportunities are published.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co submit bids automatically?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Brost Co prepares and validates the bid package, but you retain final control. Signatures, attestations, and submission stay with your team.",
        },
      },
      {
        "@type": "Question",
        name: "How much does Brost Co cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: pricingAnswer,
        },
      },
      {
        "@type": "Question",
        name: "Who is Brost Co built for?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co is designed for small and mid-size federal services contractors pursuing construction, facilities, and professional services work without a large in-house capture team.",
        },
      },
      {
        "@type": "Question",
        name: "How is this different from a CRM?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "A general CRM tracks deals. Brost Co runs the federal bid lifecycle, including NAICS fit, set-asides, solicitation deadlines, subcontractor coverage, pricing, compliance gates, and submission readiness.",
        },
      },
    ],
  };

  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Brost Co",
    url: SITE_URL,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webpage) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(app) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(website) }}
      />
    </>
  );
}
