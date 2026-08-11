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
  title: "Brost Co | Government Contracting Software That Runs Your Pipeline",
  description:
    "Brost Co helps federal services contractors find, score, pursue, and manage government contract opportunities. Source subcontractors, collect pricing, prepare bids, and know what needs attention each day.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Brost Co | Government Contracting Software",
    description:
      "Find, evaluate, pursue, and manage federal opportunities in one automated platform. Founding pricing available for a limited time.",
    url: SITE_URL,
    type: "website",
  },
  keywords: [
    "government contracting software",
    "government bid software",
    "SAM.gov opportunity software",
    "federal contracting software",
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
