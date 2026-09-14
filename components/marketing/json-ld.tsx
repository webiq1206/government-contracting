import { HOME_FAQ, TRIAL_COPY, USAGE_COPY } from "./site-content";
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
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: "BrostCo",
      legalName: "BROSTCO HOLDINGS LLC",
      url: SITE_URL,
      logo: `${SITE_URL}/brand/b-mark.png`,
      email: "hello@brostco.com",
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "BrostCo",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: SITE_URL,
      description:
        "AI for government contractors: opportunity discovery, requirement analysis, subcontractor coordination, and bid preparation. Your team reviews and submits.",
      offers: {
        "@type": "Offer",
        name: promoActive ? "Founding monthly" : "Standard monthly",
        price: String(promoActive ? foundingMonthly : standardMonthly),
        priceCurrency: "USD",
        description: `${TRIAL_COPY} ${USAGE_COPY}`,
        url: `${SITE_URL}/pricing-guide`,
        ...(promoActive && promoEndsAt ? { priceValidUntil: promoEndsAt } : {}),
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: HOME_FAQ.map(([name, text]) => ({
        "@type": "Question",
        name,
        acceptedAnswer: { "@type": "Answer", text },
      })),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "BrostCo",
      url: SITE_URL,
    },
  ];
  return (
    <>
      {data.map((item, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(item).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}
