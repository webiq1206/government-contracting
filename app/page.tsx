import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/landing-page";
import { getFoundingPromo, type PromoWindow } from "@/lib/billing/promo";
import {
  FOUNDING_MONTHLY_USD,
  STANDARD_MONTHLY_USD,
} from "@/lib/billing/prices";
import { trackEvent } from "@/lib/analytics";
import { JsonLd } from "@/components/marketing/json-ld";

export const dynamic = "force-dynamic";

const SITE_URL = process.env.APP_URL || "https://brostco.com";
const PUBLIC_PROMO_BUDGET_MS = 1500;
const STANDARD_PROMO_FALLBACK: PromoWindow = {
  active: false,
  startedAt: null,
  endsAt: null,
  durationDays: 5,
  remainingMs: 0,
};

async function loadPublicPromo(): Promise<PromoWindow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getFoundingPromo({ startIfMissing: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Public promotion lookup timed out")),
          PUBLIC_PROMO_BUDGET_MS
        );
      }),
    ]);
  } catch (error) {
    // The public marketing page must remain available during transient database
    // startup or connectivity problems. Authenticated billing paths still use
    // the database as normal; only this public render falls back to the standard plan.
    console.warn(
      "[landing] promotion lookup unavailable; rendering standard plan",
      error instanceof Error ? error.message : String(error)
    );
    return STANDARD_PROMO_FALLBACK;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const metadata: Metadata = {
  title: "Brost Co | Hard Parts of Government Contracting Done",
  description:
    "Brost Co watches SAM.gov, scores fit, emails subcontractors, and builds bid packages. You decide, call when needed, and submit. Start free of the busywork.",
  alternates: { canonical: SITE_URL },
  openGraph: {
    title: "Brost Co | Hard Parts of Government Contracting Done",
    description:
      "Government contracting software that takes the slow work off your plate: SAM.gov intake, fit scoring, sub outreach, and bid package prep. You keep judgment and submission.",
    url: SITE_URL,
    type: "website",
    siteName: "Brost Co",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Brost Co, Automated Government Procurement Software",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Brost Co | Hard Parts of Government Contracting Done",
    description:
      "Brost Co watches SAM.gov, scores fit, emails subcontractors, and builds bid packages. You decide, call when needed, and submit.",
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
  const [promo] = await Promise.all([
    loadPublicPromo(),
    trackEvent({ event: "landing_view", path: "/" }),
  ]);

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
