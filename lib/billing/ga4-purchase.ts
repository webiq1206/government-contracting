import { createHash } from "node:crypto";
import { getStripe } from "./stripe";
import type { Ga4Purchase } from "@/lib/client/ga4";

/** Read-only Stripe verification. A success URL alone never proves a sale. */
export async function verifiedGa4Purchase(sessionId: string | undefined, orgId: string): Promise<Ga4Purchase | null> {
  if (!sessionId || !/^cs_live_[A-Za-z0-9]+$/.test(sessionId)) return null;
  const stripe = getStripe();
  if (!stripe) return null;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {}, { timeout: 3000, maxNetworkRetries: 0 });
    if (!session.livemode || session.status !== "complete" || session.payment_status !== "paid"
      || session.client_reference_id !== orgId || session.metadata?.org_id !== orgId
      || session.currency !== "usd" || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0
      || !["founding", "standard"].includes(session.metadata?.plan_key)
      || !["month", "year"].includes(session.metadata?.interval)) return null;
    return {
      transaction_id: createHash("sha256").update(sessionId).digest("hex"),
      value: session.amount_total / 100, currency: "USD",
      plan: session.metadata.plan_key, interval: session.metadata.interval,
    };
  } catch {
    // Analytics must never stop the customer's return from checkout.
    return null;
  }
}
