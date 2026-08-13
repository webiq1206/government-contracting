/**
 * The one place pricing is defined.
 *
 * Every amount, interval, trial length, and Stripe price ID for every plan we
 * sell lives here. Nothing else in the application may hardcode a dollar
 * figure: the marketing page, checkout, the webhook, and the admin view all
 * read from this catalog, so a price change is one edit plus a Stripe price.
 *
 * Stripe remains authoritative for what a customer is ACTUALLY charged. The
 * amounts here drive display and the setup script; when a subscription is
 * recorded we store the amount Stripe reports, not the amount we expected, so
 * a drift between the two can never silently overstate what someone is paying.
 */

export type PlanKey = "standard" | "founding" | "none";
export type BillingInterval = "month" | "year";

/**
 * Stripe tax code for the products we sell: software as a service, business
 * use. Required on every product once Managed Payments is enabled, which is
 * the default on newer Stripe accounts; without it checkout is rejected
 * outright rather than degrading.
 */
export const PRODUCT_TAX_CODE = "txcd_10103000";

/** Free trial applied to every new subscription, in days. */
export const TRIAL_DAYS = 7;

/**
 * Annual is priced at seven months of the monthly rate, i.e. five months free.
 * Expressed as a multiplier rather than a second set of literals so the two
 * can never drift apart.
 */
export const ANNUAL_MONTHS_CHARGED = 7;

export interface PlanDef {
  key: Exclude<PlanKey, "none">;
  name: string;
  /** Shown on pricing surfaces. */
  blurb: string;
  monthlyUsd: number;
  /** True for rates that must never be repriced on an existing subscriber. */
  grandfathered: boolean;
  /** Only offered while the founding promo window is open. */
  promoOnly: boolean;
}

export const PLANS: Record<Exclude<PlanKey, "none">, PlanDef> = {
  standard: {
    key: "standard",
    name: "Standard",
    blurb: "Full platform access.",
    monthlyUsd: 2997,
    grandfathered: false,
    promoOnly: false,
  },
  founding: {
    key: "founding",
    name: "Founding",
    blurb: "Founding rate, locked for the life of the subscription.",
    monthlyUsd: 497,
    // The whole promise of this plan: a renewal must never move it to standard.
    grandfathered: true,
    promoOnly: true,
  },
};

export interface PlanPrice {
  plan: Exclude<PlanKey, "none">;
  interval: BillingInterval;
  amountUsd: number;
  amountCents: number;
  /** Effective monthly cost, for "works out at $X/mo" copy on annual. */
  perMonthUsd: number;
  /** Dollars saved per year versus paying monthly. Zero for monthly. */
  savingsUsd: number;
  /** Stable key used to find or create this price in Stripe. */
  lookupKey: string;
}

export function planPrice(
  plan: Exclude<PlanKey, "none">,
  interval: BillingInterval
): PlanPrice {
  const monthly = PLANS[plan].monthlyUsd;
  const amountUsd = interval === "year" ? monthly * ANNUAL_MONTHS_CHARGED : monthly;
  return {
    plan,
    interval,
    amountUsd,
    amountCents: amountUsd * 100,
    perMonthUsd: interval === "year" ? Math.round(amountUsd / 12) : monthly,
    savingsUsd: interval === "year" ? monthly * 12 - amountUsd : 0,
    lookupKey: `brostco_${plan}_${interval}`,
  };
}

/** Every price we sell, for the setup script and the pricing UI. */
export function allPrices(): PlanPrice[] {
  const out: PlanPrice[] = [];
  for (const plan of ["standard", "founding"] as const) {
    for (const interval of ["month", "year"] as const) {
      out.push(planPrice(plan, interval));
    }
  }
  return out;
}

/**
 * Environment variable holding the Stripe price ID for one plan and interval.
 *
 * Monthly falls back to the original single-interval names so an existing
 * deployment keeps working after this change without an env edit.
 */
export function priceEnvNames(
  plan: Exclude<PlanKey, "none">,
  interval: BillingInterval
): string[] {
  const upper = plan.toUpperCase();
  if (interval === "year") return [`STRIPE_PRICE_${upper}_ANNUAL`];
  return [`STRIPE_PRICE_${upper}_MONTHLY`, `STRIPE_PRICE_${upper}`];
}

/** Configured Stripe price ID for a plan and interval, or null. */
export function priceIdFor(
  plan: Exclude<PlanKey, "none">,
  interval: BillingInterval
): string | null {
  for (const name of priceEnvNames(plan, interval)) {
    const v = process.env[name]?.trim();
    if (v) return v;
  }
  return null;
}

/** Reverse lookup: which plan and interval a Stripe price ID belongs to. */
export function planForPriceId(
  priceId: string | null | undefined
): { plan: PlanKey; interval: BillingInterval | null } {
  if (!priceId) return { plan: "none", interval: null };
  for (const plan of ["standard", "founding"] as const) {
    for (const interval of ["month", "year"] as const) {
      if (priceIdFor(plan, interval) === priceId) return { plan, interval };
    }
  }
  return { plan: "none", interval: null };
}

/**
 * Whether the deployment is fully wired for billing. Used to refuse checkout
 * loudly rather than letting someone through unpaid.
 */
export function billingConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.STRIPE_SECRET_KEY?.trim()) missing.push("STRIPE_SECRET_KEY");
  if (!process.env.STRIPE_WEBHOOK_SECRET?.trim()) missing.push("STRIPE_WEBHOOK_SECRET");
  // Only the plans a customer can actually buy today must be present. A
  // missing annual price disables annual; a missing standard monthly price
  // means nobody can subscribe at all.
  if (!priceIdFor("standard", "month")) missing.push("STRIPE_PRICE_STANDARD_MONTHLY");
  return { ok: missing.length === 0, missing };
}

/** True when a live-mode key is in use, so the UI can warn about test data. */
export function isLiveMode(): boolean {
  return (process.env.STRIPE_SECRET_KEY ?? "").startsWith("sk_live_");
}
