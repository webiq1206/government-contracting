import Link from "next/link";
import { getFoundingPromo } from "@/lib/billing/promo";
import { ANNUAL_MONTHS_CHARGED } from "@/lib/billing/catalog";
import { FOUNDING_MONTHLY_USD, STANDARD_MONTHLY_USD } from "@/lib/billing/prices";

/**
 * The paywall, shown over the customer's own dashboard when their trial ends.
 *
 * Deliberately an overlay rather than a redirect. Someone who spent a week
 * setting this up should hit the paywall while looking at their own pipeline,
 * not on a bare billing page that has forgotten what they were doing: the
 * thing they are being asked to pay for is visible behind the panel, which is
 * both more honest and more persuasive than a page that says "access denied".
 *
 * It cannot be dismissed, and it does not need to be. Every mutating API route
 * independently returns 402 for an expired trial, so this panel is the
 * explanation and the fix, not the enforcement. Someone who removes it with
 * devtools gets a dashboard whose every button fails.
 *
 * Two ways out, both deliberate: pay, or sign out. There is no "remind me
 * later", because there is nothing later to remind them of.
 */
export async function TrialExpiredModal() {
  const promo = await getFoundingPromo({ startIfMissing: false });
  const plan = promo.active ? "founding" : "standard";
  const monthly = promo.active ? FOUNDING_MONTHLY_USD : STANDARD_MONTHLY_USD;
  const annual = monthly * ANNUAL_MONTHS_CHARGED;
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trial-expired-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-background/85 p-4 backdrop-blur-sm"
    >
      <div className="card w-full max-w-md space-y-5 shadow-xl">
        <div>
          <p className="eyebrow-gold">Free trial ended</p>
          <h2
            id="trial-expired-title"
            className="mt-1.5 font-display text-2xl leading-tight text-foreground"
          >
            {promo.active
              ? "Keep going at the founding rate"
              : "Choose a plan to keep going"}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Everything behind this panel is still yours: your company profile, every
            opportunity found and scored for you, your subcontractors, and any quotes
            already received. Choosing a plan brings it all back right now.
          </p>
        </div>

        <div className="space-y-2">
          <Link
            href={`/api/billing/checkout?plan=${plan}&interval=month`}
            className="btn-primary block w-full text-center"
          >
            {money(monthly)} / month
          </Link>
          <Link
            href={`/api/billing/checkout?plan=${plan}&interval=year`}
            className="btn-ghost block w-full text-center"
          >
            {money(annual)} / year
            <span className="ml-1 text-xs text-slate-500">
              · {12 - ANNUAL_MONTHS_CHARGED} months free
            </span>
          </Link>
        </div>

        {promo.active && (
          <p className="text-xs leading-relaxed text-slate-500">
            The founding rate of {money(FOUNDING_MONTHLY_USD)} is locked for as long as you
            stay subscribed. Standard pricing is {money(STANDARD_MONTHLY_USD)} a month.
          </p>
        )}

        <p className="text-xs leading-relaxed text-slate-500">
          You have not been charged and no card is on file. Cancel any time from the billing
          portal.
        </p>

        <div className="flex items-center justify-between border-t border-border pt-3 text-xs">
          <Link href="/settings/billing" className="text-accent hover:underline">
            Billing details
          </Link>
          <Link href="/api/auth/logout" className="text-slate-500 hover:underline">
            Sign out
          </Link>
        </div>
      </div>
    </div>
  );
}
