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
  title: "Brost Co | Procurement Execution for Federal Contractors",
  description:
    "Win the right government contracts. Brost Co finds, scores, sources, and prepares opportunities so you stop managing the process by hand.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Brost Co | Procurement Execution for Federal Contractors",
    description:
      "Brost Co finds the right opportunities, scores the fit, builds subcontractor coverage, and prepares your bids. You stay focused on decisions only you can make.",
    url: SITE_URL,
    type: "website",
    siteName: "Brost Co",
  },
  twitter: {
    card: "summary_large_image",
    title: "Brost Co | Procurement Execution for Federal Contractors",
    description:
      "Win the right government contracts. Brost Co finds, scores, sources, and prepares opportunities so you stop managing the process by hand.",
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
