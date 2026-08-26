/**
 * Which platform keys a trial may borrow, and how far.
 *
 * The trade being made: a prospect who must obtain four credentials before
 * seeing anything will mostly not bother, and a SAM.gov key alone can take
 * days to issue. So during the trial we lend the two credentials that are
 * purely pay-per-use, and meter them.
 *
 * SAM is deliberately NOT lent, and cost is not the reason. The opportunity
 * monitor makes up to 100 requests per run on its own schedule, several
 * hundred a day per organization, against a public key rate limited near
 * 1,000 a day.
 * Two or three concurrent trials on our key would exhaust the quota and stop
 * OUR pipeline and every other trial at the same time. It is also the one
 * credential a contractor must hold to bid at all, so asking for it is asking
 * for something they already need.
 */
import type { AllowedEnvKey } from "../integration-settings";

/**
 * Call budgets for a borrowed key, for the whole trial rather than per day.
 *
 * Sized from what the integrations actually cost. Anthropic averages a few
 * cents a call across scoring and briefs, Places is about two to three cents
 * across searches and detail lookups, so these cap a trial's borrowed spend
 * near fifteen dollars: enough to work real opportunities end to end, small
 * enough that a bad actor signing up repeatedly is an annoyance rather than a
 * bill.
 *
 * A key absent from this map is never lent.
 */
export const TRIAL_PLATFORM_KEY_BUDGET: Partial<Record<AllowedEnvKey, number>> = {
  ANTHROPIC_API_KEY: 250,
  GOOGLE_MAPS_API_KEY: 300,
};

export function isLendableDuringTrial(key: AllowedEnvKey): boolean {
  return key in TRIAL_PLATFORM_KEY_BUDGET;
}

/** What the customer is told once a borrowed key is used up. */
export function trialKeyExhaustedCopy(key: AllowedEnvKey): string {
  const what =
    key === "ANTHROPIC_API_KEY"
      ? "AI scoring and bid briefs"
      : key === "GOOGLE_MAPS_API_KEY"
        ? "finding subcontractors"
        : "this integration";
  return (
    `Your trial's included ${what} has been used up. Add your own key in ` +
    `Settings, Connected services to carry on. It takes a couple of minutes ` +
    `and you only pay for what you use.`
  );
}
