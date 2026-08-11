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
  title: "Brost Co | Run Your Entire Federal Bid Pipeline",
  description:
    "Stop chasing federal bids. Brost Co finds, scores, sources, and prepares government contract opportunities so you focus on judgment, calls, and submission.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Brost Co | Run Your Entire Federal Bid Pipeline",
    description:
      "Procurement execution software for federal services contractors. One pipeline from SAM.gov to submitted bid, with Today and Guide Me when a person is needed.",
    url: SITE_URL,
    type: "website",
    siteName: "Brost Co",
  },
  twitter: {
    card: "summary_large_image",
    title: "Brost Co | Run Your Entire Federal Bid Pipeline",
    description:
      "Stop chasing federal bids. Brost Co finds, scores, sources, and prepares opportunities so you focus on judgment, calls, and submission.",
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
