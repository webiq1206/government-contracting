import Link from "next/link";

/**
 * Shown while the subscription is past_due: a renewal charge failed and
 * Stripe is retrying the card. Access deliberately stays on during that
 * window (see lib/billing/entitlements.ts), so this banner is the in-app half
 * of dunning: it tells the customer exactly what happened and where to fix
 * it, while the agents keep their bids moving underneath.
 */
export function PaymentFailedBanner() {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-risk/40 bg-risk/10 px-4 py-2 text-sm">
      <p className="text-foreground">
        <span className="font-semibold">Your last payment did not go through.</span>{" "}
        Everything keeps running while the charge is retried, but access ends if it
        cannot be collected.
      </p>
      <Link href="/settings/billing" className="btn-ghost shrink-0 text-xs">
        Update card
      </Link>
    </div>
  );
}
