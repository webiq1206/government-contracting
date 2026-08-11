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
    email: "hello@brostco.com",
    description:
      "Brost Co is government contracting software that helps businesses find, evaluate, pursue, and manage federal opportunities.",
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

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Brost Co?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co is procurement execution software for federal services contractors. It monitors opportunities, scores fit, sources subcontractors, tracks pricing, and keeps a Today queue of work that needs a person.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co replace SAM.gov?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. SAM.gov remains the official source for federal postings and entity registration. Brost Co organizes work after records arrive.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co submit bids automatically?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Brost Co assembles and validates bid packages, but submission requires your review and action.",
        },
      },
      {
        "@type": "Question",
        name: "How much does Brost Co cost?",
        acceptedAnswer: {
          "@type": "Answer",
          text: promoActive
            ? `Standard pricing is $${standardMonthly} per month. Founding customers who join during the launch window lock in $${foundingMonthly} per month for as long as they remain subscribed.`
            : `Brost Co is $${standardMonthly} per month.`,
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
