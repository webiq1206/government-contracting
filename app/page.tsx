import type { Metadata } from "next";
import { after } from "next/server";
import { LandingPage } from "@/components/marketing/landing-page";
import { loadPublicPromo } from "@/lib/billing/public-promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { trackEvent } from "@/lib/analytics";
import { JsonLd } from "@/components/marketing/json-ld";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";
export const metadata: Metadata = {
  title: { absolute: "AI Government Contracting Software | BrostCo" },
  description:
    "AI for government contractors: find opportunities, analyze requirements, coordinate subcontractors, and prepare bids. Start your free BrostCo trial.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "AI Government Contracting Software | BrostCo",
    description:
      "AI finds matching opportunities, reads solicitations, coordinates outreach, and prepares bids. Your team handles calls, exceptions, and final review.",
    url: SITE_URL,
    type: "website",
    siteName: "BrostCo",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "BrostCo AI Government Contracting Software",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Government Contracting Software | BrostCo",
    description:
      "AI finds opportunities, reads solicitations, coordinates subcontractors, and prepares bids. Your team handles calls and final review.",
    images: ["/og.png"],
  },
  keywords: [
    "government contracting software",
    "government bid software",
    "SAM.gov opportunity software",
    "federal contracting software",
    "federal bid pipeline",
    "government subcontractor sourcing",
    "government bid management",
    "government contracting automation",
  ],
};

export default async function HomePage() {
  // Analytics must never hold the marketing response open.
  after(() => trackEvent({ event: "landing_view", path: "/" }));
  const promo = await loadPublicPromo(true);

  const signupHref = promo.active
    ? "/signup?plan=founding"
    : "/signup?plan=standard";

  return (
    <>
      <JsonLd
        promoActive={promo.active}
        foundingMonthly={FOUNDING_MONTHLY_USD}
        standardMonthly={STANDARD_MONTHLY_USD}
        promoEndsAt={promo.endsAt}
      />
      <LandingPage
        promoActive={promo.active}
        promoEndsAt={promo.endsAt}
        standardMonthly={STANDARD_MONTHLY_USD}
        foundingMonthly={FOUNDING_MONTHLY_USD}
        signupHref={signupHref}
        loginHref="/login"
      />
    </>
  );
}
