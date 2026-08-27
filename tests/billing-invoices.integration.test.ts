/**
 * Invoices arrive more than once, out of order, and sometimes fail first.
 *
 * Stripe delivers each event at least once and does not order them, so the
 * same invoice reaches this platform on several events. Recording it must be
 * an update rather than another row, and a later success must not leave the
 * reason an earlier attempt failed sitting on what is now a receipt.
 *
 * Requires a real DATABASE_URL, skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("billing invoice records (integration)", () => {
  let query: typeof import("../lib/db").query;
  let recordInvoice: typeof import("../lib/billing/invoices").recordInvoice;
  let invoicesFor: typeof import("../lib/billing/invoices").invoicesFor;
  let recordPaymentMethod: typeof import("../lib/billing/invoices").recordPaymentMethod;

  const orgA = randomUUID();
  const orgB = randomUUID();
  const invoiceId = `in_test_${randomUUID().replace(/-/g, "").slice(0, 14)}`;

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ recordInvoice, invoicesFor, recordPaymentMethod } = await import("../lib/billing/invoices"));
    for (const [id, name] of [[orgA, "Invoice test A"], [orgB, "Invoice test B"]] as const) {
      await query(
        `insert into organizations (id, name) values ($1, $2) on conflict (id) do nothing`,
        [id, `${name} ${id.slice(0, 8)}`]
      );
    }
  });

  afterAll(async () => {
    await query(`delete from billing_invoices where org_id = any($1::uuid[])`, [[orgA, orgB]]);
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]);
  });

  it("records a failed charge with the reason the card gave", async () => {
    await recordInvoice({
      orgId: orgA,
      stripeInvoiceId: invoiceId,
      number: "INV-0001",
      status: "open",
      amountDueCents: 29900,
      currency: "usd",
      issuedAt: "2026-08-01T00:00:00Z",
      failureReason: "Your card was declined.",
      hostedInvoiceUrl: "https://invoice.stripe.test/one",
    });

    const [inv] = await invoicesFor(orgA);
    expect(inv.number).toBe("INV-0001");
    expect(inv.status).toBe("open");
    expect(inv.failure_reason).toBe("Your card was declined.");
  });

  it("updates that same invoice rather than filing a second one", async () => {
    await recordInvoice({
      orgId: orgA,
      stripeInvoiceId: invoiceId,
      status: "paid",
      amountPaidCents: 29900,
      paidAt: "2026-08-03T00:00:00Z",
    });

    const rows = await invoicesFor(orgA);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("paid");
    expect(rows[0].amount_paid_cents).toBe(29900);
    // The reason the first attempt failed is gone: this is a receipt now.
    expect(rows[0].failure_reason).toBeNull();
    // And nothing the later event omitted was wiped.
    expect(rows[0].number).toBe("INV-0001");
    expect(rows[0].hosted_invoice_url).toBe("https://invoice.stripe.test/one");
    expect(rows[0].amount_due_cents).toBe(29900);
  });

  it("keeps one organization's invoices out of another's", async () => {
    await recordInvoice({
      orgId: orgB,
      stripeInvoiceId: `in_other_${randomUUID().slice(0, 8)}`,
      status: "paid",
      amountPaidCents: 49700,
      issuedAt: "2026-08-10T00:00:00Z",
    });

    const a = await invoicesFor(orgA);
    const b = await invoicesFor(orgB);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0].amount_paid_cents).toBe(29900);
    expect(b[0].amount_paid_cents).toBe(49700);
  });

  it("stores a card without ever storing more than the last four digits", async () => {
    await recordPaymentMethod(orgA, { brand: "visa", last4: "4242", expMonth: 4, expYear: 2029 });
    const row = await query<{ card_brand: string; card_last4: string; card_exp_year: number }>(
      `select card_brand, card_last4, card_exp_year from organizations where id = $1`,
      [orgA]
    );
    expect(row[0].card_brand).toBe("visa");
    expect(row[0].card_last4).toBe("4242");
    expect(row[0].card_exp_year).toBe(2029);

    // A full number cannot be written even by mistake: the constraint refuses
    // anything that is not exactly four digits.
    await expect(
      query(`update organizations set card_last4 = $2 where id = $1`, [orgA, "4242424242424242"])
    ).rejects.toThrow(/organizations_card_last4_ck/);
  });

  it("leaves the card alone when Stripe named no payment method", async () => {
    await recordPaymentMethod(orgB, null);
    await recordPaymentMethod(orgB, { brand: "visa", last4: null });
    const row = await query<{ card_last4: string | null }>(
      `select card_last4 from organizations where id = $1`,
      [orgB]
    );
    expect(row[0].card_last4).toBeNull();
  });
});
