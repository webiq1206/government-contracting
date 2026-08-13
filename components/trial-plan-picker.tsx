import Link from "next/link";
import { getFoundingPromo } from "@/lib/billing/promo";
import { ANNUAL_MONTHS_CHARGED } from "@/lib/billing/catalog";

/**
 * Choosing a plan, from inside the product.
 *
 * This is the whole conversion surface now that signup no longer asks for a
 * card. It is shown to trial customers and to expired ones, and the copy
 * differs only in urgency, not in substance: the same four choices, and the
 * same promise that nothing they built is going anywhere.
 *
 * Founding eligibility is resolved server-side from the stored promo window,
 * exactly as the checkout route resolves it, so the picker can never offer a
 * rate the route will refuse to honour.
 */
export async function TrialPlanPicker({
  expired,
  foundingMonthly,
  standardMonthly,
}: {
  expired: boolean;
  foundingMonthly: number;
  standardMonthly: number;
}) {
  const promo = await getFoundingPromo({ startIfMissing: false });
  const plan = promo.active ? "founding" : "standard";
  const monthly = promo.active ? foundingMonthly : standardMonthly;
  const annual = monthly * ANNUAL_MONTHS_CHARGED;
  const money = (n: number) => `$${n.toLocaleString("en-US")}`;

  return (
    <div className="card max-w-xl space-y-4">
      <div>
        <p className="eyebrow">{expired ? "Pick up where you left off" : "Choose a plan"}</p>
        <h2 className="mt-1 font-display text-xl text-foreground">
          {promo.active ? "Founding rate, locked for life" : "Full platform access"}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
          {promo.active
            ? `${money(foundingMonthly)} a month for as long as you stay subscribed, while founding enrolment is open. Standard is ${money(standardMonthly)}.`
            : `${money(standardMonthly)} a month. Everything in the platform, no limits.`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Link
          href={`/api/billing/checkout?plan=${plan}&interval=month`}
          className="btn-primary block text-center"
        >
          {money(monthly)} / month
        </Link>
        <Link
          href={`/api/billing/checkout?plan=${plan}&interval=year`}
          className="btn-ghost block text-center"
        >
          {money(annual)} / year
          <span className="ml-1 text-xs text-slate-500">
            ({12 - ANNUAL_MONTHS_CHARGED} months free)
          </span>
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-slate-500">
        Billing starts today, and your card is charged at checkout. Cancel any time from the
        billing portal; you keep access to the end of the period you paid for.
      </p>
    </div>
  );
}
