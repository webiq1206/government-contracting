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
    "@id": `${SITE_URL}/#organization`,
    name: "Brost Co",
    legalName: "BROSTCO HOLDINGS LLC",
    url: SITE_URL,
    logo: `${SITE_URL}/brand/b-mark.png`,
    image: `${SITE_URL}/opengraph-image`,
    email: "hello@brostco.com",
    description:
      "Brost Co is government contracting software for federal services contractors. It does the hard, slow parts of federal bidding: SAM.gov intake, fit scoring, subcontractor outreach, and bid package prep. You keep judgment and submission.",
  };

  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${SITE_URL}/#webpage`,
    name: "Brost Co | Hard Parts of Government Contracting Done",
    url: SITE_URL,
    description:
      "Brost Co watches SAM.gov, scores opportunities, finds and emails subcontractors, and builds bid packages. You decide, call when needed, and submit.",
    primaryImageOfPage: {
      "@type": "ImageObject",
      url: `${SITE_URL}/opengraph-image`,
      width: 1200,
      height: 630,
    },
    isPartOf: { "@type": "WebSite", name: "Brost Co", url: SITE_URL },
    about: { "@id": `${SITE_URL}/#organization` },
  };

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: SITE_URL,
      },
    ],
  };

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How Brost Co runs a federal bid",
    description:
      "Four phases from a SAM.gov posting to agency submission. Brost Co handles the automatic work. You handle judgment, calls, and the final send.",
    totalTime: "P14D",
    step: [
      {
        "@type": "HowToStep",
        position: 1,
        name: "Find the right work",
        text: "Brost Co watches SAM.gov, pulls matching postings, and scores each one against your company. You only decide borderline fits. Strong matches move forward on their own.",
        url: `${SITE_URL}/#workflow`,
      },
      {
        "@type": "HowToStep",
        position: 2,
        name: "Get pricing",
        text: "Brost Co reads the solicitation, finds local subcontractors, emails them, and follows up. You call when email is not enough, then enter the quote in one place.",
        url: `${SITE_URL}/#workflow`,
      },
      {
        "@type": "HowToStep",
        position: 3,
        name: "Build the package",
        text: "Brost Co rolls up pricing, assembles the bid package, and runs compliance checks. You review the package and clear anything only a person can sign or attest.",
        url: `${SITE_URL}/#workflow`,
      },
      {
        "@type": "HowToStep",
        position: 4,
        name: "Submit",
        text: "You submit through the required agency channel. Brost Co keeps the deadline visible and waits with you for the agency decision. Nothing leaves without your approval.",
        url: `${SITE_URL}/#workflow`,
      },
    ],
  };

  const app = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Brost Co",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    url: SITE_URL,
    description:
      "Government contracting software that takes the hard, slow parts of federal bidding off your plate: opportunity discovery, scoring, subcontractor sourcing, quote tracking, and bid preparation.",
    offers: promoActive
      ? [
          {
            "@type": "Offer",
            name: "Founding customer monthly",
            price: String(foundingMonthly),
            priceCurrency: "USD",
            category: "Subscription",
            description:
              "Limited founding rate locked for the life of an active subscription. Includes a free 7-day trial; then billed monthly unless canceled.",
            priceValidUntil: promoEndsAt ?? undefined,
            url: `${SITE_URL}/signup?plan=founding`,
          },
          {
            "@type": "Offer",
            name: "Standard monthly",
            price: String(standardMonthly),
            priceCurrency: "USD",
            category: "Subscription",
            description:
              "Standard monthly subscription with a free 7-day trial; then billed monthly unless canceled.",
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
            description:
              "Standard monthly subscription with a free 7-day trial; then billed monthly unless canceled.",
            url: `${SITE_URL}/signup?plan=standard`,
          },
        ],
  };

  const pricingAnswer = promoActive
    ? `Standard pricing is $${standardMonthly} per month. Founding customers who join during the launch window lock in $${foundingMonthly} per month for as long as they remain subscribed. Every plan starts with a free 7-day trial. After the trial, your card is charged automatically unless you cancel.`
    : `Brost Co is $${standardMonthly} per month. Every plan starts with a free 7-day trial. After the trial, your card is charged automatically unless you cancel.`;

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What is Brost Co?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co is government contracting software for federal services contractors. It watches SAM.gov for matching work, scores each opportunity against your company, finds subcontractors, tracks quotes, builds the bid package, and shows you one daily list of decisions that need a person.",
        },
      },
      {
        "@type": "Question",
        name: "What work does Brost Co take off my plate?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Brost Co handles SAM.gov intake, fit scoring, reading the solicitation, finding and emailing subcontractors, quote tracking, package assembly, and compliance checks. You keep pursue-or-pass decisions, calls when a person is needed, quote entry, and final submission.",
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
          text: "No. Brost Co prepares and validates the bid package, but you keep final control. Signatures, attestations, and submission stay with your team.",
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
          text: "Brost Co is built for small and mid-size federal services contractors in construction, facilities, and professional services that do not have a large capture team.",
        },
      },
      {
        "@type": "Question",
        name: "How is this different from a CRM?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "A general CRM tracks deals. Brost Co runs the federal bid lifecycle: NAICS fit, set-asides, deadlines, subcontractor coverage, pricing, compliance checks, and submission readiness.",
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo) }}
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
