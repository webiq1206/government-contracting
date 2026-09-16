import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
  FAQ,
} from "@/components/marketing/site-shell";
import { CostCalculator } from "@/components/marketing/cost-calculator";
import { HOME_FAQ, USAGE_COPY } from "@/components/marketing/site-content";
import {
  planPrice,
  ANNUAL_MONTHS_CHARGED,
  TRIAL_DAYS,
} from "@/lib/billing/catalog";
import { loadPublicPromo } from "@/lib/billing/public-promo";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pricing and usage | BrostCo",
  description:
    "Compare BrostCo monthly and annual pricing, understand separate service usage costs, and estimate the value using your own bid volume and time savings.",
  alternates: { canonical: "/pricing-guide" },
};
const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
export default async function PricingGuidePage() {
  const promo = await loadPublicPromo(false);
  const plan = promo.active ? "founding" : "standard";
  const monthly = planPrice(plan, "month");
  const annual = planPrice(plan, "year");
  const faq = [
    HOME_FAQ[4],
    HOME_FAQ[5],
    [
      "What happens if I cancel?",
      "Cancel from Billing settings. Paid access continues through the end of your paid period. If you only created a no-card trial and did not complete checkout, there is no subscription charge to cancel.",
    ],
    [
      "What about existing founding subscriptions?",
      "Eligible founding subscriptions keep their rate for the life of the active subscription. Current offers and eligibility are shown in your account. Canceling and later subscribing again does not preserve an expired promotional offer.",
    ],
  ] as const;
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Pricing"
        title="One platform. Clear subscription and usage costs."
        copy={`${TRIAL_DAYS} days free, with no credit card required. Explore the workflow before choosing a paid subscription. Service usage is separate.`}
      />
      <section className="bco-container bco-section">
        <div className="bco-pricing-grid">
          <article className="bco-price-card">
            <p className="bco-kicker">
              {promo.active ? "Founding" : "Standard"} / Monthly
            </p>
            <p className="bco-price">
              {usd(monthly.amountUsd)}
              <span>/month</span>
            </p>
            <p>Billed monthly after you choose paid access.</p>
            <ul className="bco-check-list">
              <li>Full platform access</li>
              <li>Opportunity, subcontractor, and bid workflows</li>
              <li>No per-seat or per-opportunity subscription fee</li>
            </ul>
            <Link href={`/signup?plan=${plan}`} className="bco-button">
              Start free trial ↗
            </Link>
            <p className="bco-caption">
              Service usage and applicable taxes are additional.
            </p>
          </article>
          <article className="bco-price-card bco-price-highlight">
            <p className="bco-kicker">
              {promo.active ? "Founding" : "Standard"} / Annual
            </p>
            <p className="bco-price">
              {usd(annual.amountUsd)}
              <span>/year</span>
            </p>
            <p>
              Paid upfront. About {usd(annual.perMonthUsd)}/month, averaged
              across the year.
            </p>
            <ul className="bco-check-list">
              <li>The same full platform access</li>
              <li>Pay for {ANNUAL_MONTHS_CHARGED} months instead of 12</li>
              <li>Save {usd(annual.savingsUsd)} versus 12 monthly payments</li>
            </ul>
            <Link href={`/signup?plan=${plan}`} className="bco-button">
              Start free trial ↗
            </Link>
            <p className="bco-caption">
              Choose your billing interval in Billing after signup. Checkout
              confirms available plans, payment dates, and taxes. Service usage
              is additional.
            </p>
          </article>
        </div>
        {promo.active && (
          <p className="bco-note" style={{ marginTop: 24 }}>
            Founding pricing is available during the current eligibility window.
            The standard monthly price is{" "}
            {usd(planPrice("standard", "month").amountUsd)}. Your offer and
            eligibility are confirmed at checkout.
          </p>
        )}
        <div className="bco-subnav">
          <a href="#usage">Understand service costs</a>
          <a href="#value">Estimate the value</a>
          <Link href="/get-started">What you need for the trial ↗</Link>
        </div>
      </section>
      <section id="usage" className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Separate from the subscription"
            title="Choose how services are paid for."
          >
            {USAGE_COPY}
          </SectionHeading>
          <div className="bco-card-grid">
            <article className="bco-card">
              <p className="bco-kicker">Option 1</p>
              <h3>Use supported platform services</h3>
              <p>
                Select an available platform connection and accept usage billing
                in your account. Confirmed provider cost is billed with a 25%
                markup. Usage and available limits are visible in API Usage.
              </p>
              <span className="bco-card-result">
                Provider cost × 1.25 = platform usage charge
              </span>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">Option 2</p>
              <h3>Connect eligible keys of your own</h3>
              <p>
                Use your own provider account for eligible services and pay that
                provider directly. Availability depends on the service and your
                account setup.
              </p>
              <span className="bco-card-result">
                Your provider bills its usage separately
              </span>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">During the trial</p>
              <h3>Explore within trial allowances</h3>
              <p>
                Supported trial services can use platform connections within
                usage limits. Some workflows still need your own setup, such as
                SAM.gov access and a mailbox for outreach.
              </p>
              <span className="bco-card-result">
                Check connections and allowances in setup
              </span>
            </article>
          </div>
          <div className="bco-note" style={{ marginTop: 28 }}>
            <strong>Which services affect the total?</strong>
            <p>
              AI analysis uses Anthropic Claude and OpenAI models. Subcontractor discovery and
              verification can use lookup services such as Google Maps. Other
              connected services may have their own charges. Your usage depends
              on the work run, the selected connection, and provider pricing.
            </p>
            <p>
              Your mailbox and external service subscriptions may also have
              their own costs. Review your account&apos;s service choices and limits
              before running paid work.
            </p>
          </div>
        </div>
      </section>
      <section id="value" className="bco-container bco-section">
        <SectionHeading
          eyebrow="Does it fit your workload?"
          title="Compare the cost with your own time."
        >
          If you pursue only occasional bids, a simpler approach may suit you.
          Use your expected hours saved and bid volume to estimate the value
          before you commit.
        </SectionHeading>
        <CostCalculator />
        <Link href="/compare" className="bco-text-link">
          Compare the other approaches ↗
        </Link>
      </section>
      <section className="bco-container bco-section bco-faq-section">
        <SectionHeading title="Trial and billing questions." />
        <FAQ items={faq} />
      </section>
      <TrialCTA />
    </MarketingShell>
  );
}
