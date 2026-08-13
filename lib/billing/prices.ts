/**
 * Backwards-compatible shim.
 *
 * Pricing now lives in one place, lib/billing/catalog.ts. These re-exports
 * exist so older import sites keep working; nothing new should import from
 * here, and no amount should ever be defined in this file again.
 */
export {
  TRIAL_DAYS,
  PLANS,
  planPrice,
  allPrices,
  type PlanKey,
  type BillingInterval,
} from "./catalog";

import { PLANS, planPrice, type PlanKey } from "./catalog";

export const STANDARD_MONTHLY_USD = PLANS.standard.monthlyUsd;
export const FOUNDING_MONTHLY_USD = PLANS.founding.monthlyUsd;
export const STANDARD_MONTHLY_CENTS = STANDARD_MONTHLY_USD * 100;
export const FOUNDING_MONTHLY_CENTS = FOUNDING_MONTHLY_USD * 100;

export function planAmountUsd(plan: PlanKey): number | null {
  return plan === "none" ? null : planPrice(plan, "month").amountUsd;
}

export function annualSavingsUsd(): number {
  return (STANDARD_MONTHLY_USD - FOUNDING_MONTHLY_USD) * 12;
}
