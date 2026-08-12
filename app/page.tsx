import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { getFoundingPromo } from "@/lib/billing/promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { trackEvent } from "@/lib/analytics";
import { JsonLd } from "@/components/marketing/json-ld";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";

export const metadata: Metadata = {
  title: "Brost Co | Government Contracting Software",
  description:
    "Brost Co finds federal work that fits you, scores each opportunity, sources subcontractors, and prepares bid packages. You approve every decision that matters.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Brost Co | Government Contracting Software",
    description:
      "Government contracting software for federal services contractors. Monitor SAM.gov, score fit, source subcontractors, track quotes, and prepare bids in one place.",
    url: SITE_URL,
    type: "website",
    siteName: "Brost Co",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Brost Co government contracting software for federal services contractors",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brost Co | Government Contracting Software",
    description:
      "Brost Co finds federal work that fits you, scores each opportunity, sources subcontractors, and prepares bid packages. You approve every decision that matters.",
    images: ["/twitter-image"],
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
  const promo = await getFoundingPromo({ startIfMissing: true });
  await trackEvent({ event: "landing_view", path: "/" });

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
