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
      "Brost Co is procurement execution software for federal services contractors. It finds, scores, sources, and prepares government contract opportunities.",
  };

  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Brost Co | Run Your Entire Federal Bid Pipeline",
    url: SITE_URL,
    description:
      "Stop chasing federal bids. Brost Co finds, scores, sources, and prepares federal opportunities so you focus on judgment, calls, and submission.",
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
          text: "Brost Co is procurement execution software for federal services contractors. It monitors SAM.gov, scores opportunities, writes plain-English briefs, sources subcontractors, assembles bid packages, and keeps one Today queue for everything that still needs a person.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co replace SAM.gov?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. SAM.gov remains the official source for federal postings and your entity registration. Brost Co reads from SAM.gov and organizes the work after records arrive. You still renew registrations and submit through agency channels.",
        },
      },
      {
        "@type": "Question",
        name: "Does Brost Co submit bids automatically?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Brost Co assembles and validates bid packages, but submission requires your review and action. Signatures, attestations, and portal uploads stay with you.",
        },
      },
      {
        "@type": "Question",
        name: "Who is Brost Co for?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Small and mid-size federal services contractors who bid on construction, facilities, or professional services work and need a disciplined pipeline without hiring a full capture team.",
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
        name: "Will Brost Co guarantee wins?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "No. Scoring and automation reduce wasted effort on poor fits and speed up good ones. Outcomes still depend on your pricing, past performance, and the competition.",
        },
      },
      {
        "@type": "Question",
        name: "How is this different from a generic CRM?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co is built around the federal bid lifecycle: NAICS fit, set-asides, subcontractor coverage, compliance gates, and SAM.gov intake. Stages, Today, and opportunity pages follow that journey instead of generic deal fields.",
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
