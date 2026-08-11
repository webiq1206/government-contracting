/** SaaS list prices in whole USD (display) and cents (Stripe). */

export const STANDARD_MONTHLY_USD = 2997;
export const FOUNDING_MONTHLY_USD = 597;

export const STANDARD_MONTHLY_CENTS = STANDARD_MONTHLY_USD * 100;
export const FOUNDING_MONTHLY_CENTS = FOUNDING_MONTHLY_USD * 100;

export type PlanKey = "standard" | "founding" | "none";

export function planAmountUsd(plan: PlanKey): number | null {
  if (plan === "standard") return STANDARD_MONTHLY_USD;
  if (plan === "founding") return FOUNDING_MONTHLY_USD;
  return null;
}

export function annualSavingsUsd(): number {
  return (STANDARD_MONTHLY_USD - FOUNDING_MONTHLY_USD) * 12;
}
