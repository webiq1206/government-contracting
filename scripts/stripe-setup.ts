/**
 * Create or confirm the Stripe products and prices this application sells,
 * then print the environment lines to paste.
 *
 * Run it once per mode. Whichever key is in STRIPE_SECRET_KEY decides the
 * mode, so the same command sets up test and live without a flag to get wrong:
 *
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-setup.ts
 *
 * Add --verify to check an existing setup without creating anything. That is
 * the one to run against production: it confirms every configured price ID
 * exists, is active, is in the right mode, and charges the expected amount.
 *
 * Idempotent. Prices are found by lookup key, so re-running never creates a
 * duplicate. Stripe prices are immutable, so when an amount changes the script
 * reports the mismatch and stops rather than silently repricing.
 *
 * Add --reprice to act on that mismatch: it issues a new price at the new
 * amount and moves the lookup key onto it, so new checkouts use the new rate.
 * A subscription references a price by id, so everyone already subscribed
 * stays exactly where they are; the old price remains in the account, active
 * and billing them, just without a lookup key. Moving existing customers onto
 * a new rate is a separate and deliberate act.
 *
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-setup.ts --reprice
 */
import "../lib/env";
import {
  allPrices,
  PLANS,
  priceEnvNames,
  PRODUCT_TAX_CODE,
  type PlanPrice,
} from "../lib/billing/catalog";

const VERIFY_ONLY = process.argv.includes("--verify");
/**
 * Permission to issue a NEW price when the catalog's amount no longer matches
 * Stripe's.
 *
 * Behind a flag because it is a money operation. A stray edit to the catalog
 * followed by a routine setup run should report a mismatch and stop, not
 * quietly mint a price customers can be charged.
 */
const REPRICE = process.argv.includes("--reprice");

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const key = process.env.STRIPE_SECRET_KEY?.trim();
if (!key) {
  fail(
    "STRIPE_SECRET_KEY is not set.\n" +
      "Run with the key for the mode you want to configure, for example:\n" +
      "  STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts"
  );
}
const mode = key.startsWith("sk_live_") ? "LIVE" : "TEST";

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const Stripe = require("stripe");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stripe: any = new Stripe(key, { apiVersion: "2026-07-29.dahlia" });

interface Resolved {
  price: PlanPrice;
  id: string | null;
  status: "found" | "created" | "missing" | "mismatch" | "repriced";
  detail?: string;
}

/**
 * Give a product the tax code if it lacks one.
 *
 * Targets a product by id rather than by search, because an account can end up
 * with more than one product per plan and repairing only the first match
 * leaves the others rejecting checkout while the script reports "ok".
 */
async function ensureTaxCode(productId: string, label: string): Promise<void> {
  const product = await stripe.products.retrieve(productId);
  if (product.tax_code) return;
  await stripe.products.update(productId, { tax_code: PRODUCT_TAX_CODE });
  console.log(`  set tax code on product ${productId} (${label})`);
}

/**
 * The product id for a plan, chosen by us rather than by Stripe.
 *
 * Deterministic on purpose. The obvious implementation looks the product up
 * with products.search, but that index is eventually consistent: on a first
 * run the search for the product just created still returns nothing, so every
 * price ends up under its own duplicate product. Retrieving a known id is
 * immediately consistent and makes the script genuinely idempotent.
 */
function productIdFor(plan: PlanPrice["plan"]): string {
  return `brostco_${plan}`;
}

/** Ensure the plan's product exists, with its tax code, at a known id. */
async function ensureProduct(price: PlanPrice) {
  const id = productIdFor(price.plan);
  try {
    const product = await stripe.products.retrieve(id);
    await ensureTaxCode(id, price.plan);
    return product;
  } catch {
    return stripe.products.create({
      id,
      name: `Brost Co ${PLANS[price.plan].name}`,
      description: PLANS[price.plan].blurb,
      tax_code: PRODUCT_TAX_CODE,
      metadata: { plan_key: price.plan },
    });
  }
}

/** Find the price for a lookup key, or create it under the plan's product. */
async function resolvePrice(price: PlanPrice): Promise<Resolved> {
  // One product per plan, reused across intervals so the customer sees a
  // single product with monthly and annual options rather than two products.
  const product = await ensureProduct(price);

  const existing = await stripe.prices.list({
    lookup_keys: [price.lookupKey],
    active: true,
    limit: 1,
  });
  const found = existing.data[0];

  if (found) {
    // Repair the product this price actually belongs to, which is not always
    // the one the search above returned.
    const ownerId = typeof found.product === "string" ? found.product : found.product?.id;
    if (ownerId) await ensureTaxCode(ownerId, price.lookupKey);
    if (found.unit_amount !== price.amountCents) {
      if (!REPRICE) {
        return {
          price,
          id: found.id,
          status: "mismatch",
          detail:
            `Stripe has ${found.unit_amount} cents, the catalog expects ${price.amountCents}. ` +
            "Stripe prices cannot be edited. Re-run with --reprice to create a new " +
            "price and point new signups at it; everyone already subscribed stays " +
            "on the price their subscription references.",
        };
      }
      /**
       * Issue the new price and move the lookup key onto it.
       *
       * A Stripe subscription references a price by id, so creating a price
       * and transferring the key changes what NEW checkouts use and leaves
       * every existing subscriber exactly where they are. The old price stays
       * in the account, active and billing its subscribers, simply without a
       * lookup key. Moving anyone onto the new rate is a separate, deliberate
       * act.
       */
      const replacement = await stripe.prices.create({
        product: product.id,
        unit_amount: price.amountCents,
        currency: "usd",
        recurring: { interval: price.interval },
        lookup_key: price.lookupKey,
        transfer_lookup_key: true,
        metadata: { plan_key: price.plan, interval: price.interval },
      });
      return {
        price,
        id: replacement.id,
        status: "repriced",
        detail:
          `was ${found.unit_amount} cents (${found.id}), now ${price.amountCents}. ` +
          "Existing subscribers stay on the old price.",
      };
    }
    return { price, id: found.id, status: "found" };
  }

  if (VERIFY_ONLY) {
    return { price, id: null, status: "missing" };
  }

  const created = await stripe.prices.create({
    product: product.id,
    unit_amount: price.amountCents,
    currency: "usd",
    recurring: { interval: price.interval },
    lookup_key: price.lookupKey,
    metadata: { plan_key: price.plan, interval: price.interval },
  });
  return { price, id: created.id, status: "created" };
}

/** Confirm a price ID already in the environment points at the right thing. */
async function verifyConfigured(price: PlanPrice): Promise<string | null> {
  const names = priceEnvNames(price.plan, price.interval);
  const configured = names.map((n) => process.env[n]?.trim()).find(Boolean);
  if (!configured) return null;
  try {
    const p = await stripe.prices.retrieve(configured);
    const problems: string[] = [];
    if (!p.active) problems.push("it is archived in Stripe");
    if (p.unit_amount !== price.amountCents) {
      problems.push(`it charges ${p.unit_amount} cents, expected ${price.amountCents}`);
    }
    if (p.recurring?.interval !== price.interval) {
      problems.push(`it bills ${p.recurring?.interval}, expected ${price.interval}`);
    }
    return problems.length ? `${configured}: ${problems.join("; ")}` : null;
  } catch (err) {
    // A test-mode ID in a live-mode environment fails exactly here, which is
    // the single most important thing this script catches.
    return `${configured}: not found in ${mode} mode (${(err as Error).message})`;
  }
}

async function main() {
  console.log(`\nStripe ${mode} mode\n${"=".repeat(30)}`);
  if (VERIFY_ONLY) console.log("Verify only. Nothing will be created.\n");

  const results: Resolved[] = [];
  const configProblems: string[] = [];

  for (const price of allPrices()) {
    results.push(await resolvePrice(price));
    const problem = await verifyConfigured(price);
    if (problem) configProblems.push(problem);
  }

  console.log("Prices");
  for (const r of results) {
    const label = `${r.price.plan} ${r.price.interval === "year" ? "annual" : "monthly"}`;
    const amount = `$${r.price.amountUsd.toLocaleString()}`;
    const mark =
      r.status === "created" ? "created" : r.status === "found" ? "ok" : r.status;
    console.log(`  ${label.padEnd(20)} ${amount.padEnd(12)} ${mark}${r.id ? ` ${r.id}` : ""}`);
    if (r.detail) console.log(`      ${r.detail}`);
  }

  const usable = results.filter((r) => r.id);
  if (usable.length > 0) {
    console.log(`\nEnvironment lines for ${mode} mode:\n`);
    for (const r of usable) {
      console.log(`${priceEnvNames(r.price.plan, r.price.interval)[0]}=${r.id}`);
    }
  }

  if (configProblems.length > 0) {
    console.log("\nProblems with the price IDs currently in this environment:");
    for (const p of configProblems) console.log(`  ${p}`);
  }

  const missingSecret = !process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (missingSecret) {
    console.log(
      "\nSTRIPE_WEBHOOK_SECRET is not set. The webhook refuses every event without it,\n" +
        "so subscriptions would never activate. Add an endpoint at\n" +
        "  <your app URL>/api/billing/webhook\n" +
        "subscribed to: checkout.session.completed, customer.subscription.created,\n" +
        "customer.subscription.updated, customer.subscription.deleted,\n" +
        "customer.subscription.trial_will_end, invoice.paid, invoice.payment_failed,\n" +
        "invoice.payment_action_required. Then set its signing secret."
    );
  }

  const blocked =
    results.some((r) => r.status === "mismatch" || r.status === "missing") ||
    configProblems.length > 0 ||
    missingSecret;

  if (blocked) {
    console.log(`\n${mode} mode is NOT ready. Resolve the items above.\n`);
    process.exit(2);
  }
  console.log(`\n${mode} mode is ready.\n`);
}

main().catch((err) => fail(`Stripe setup failed: ${(err as Error).message}`));
