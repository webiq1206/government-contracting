import { query } from "@/lib/db";

/**
 * The charges on an account, recorded from Stripe's own webhooks.
 *
 * Written on every invoice event rather than only on success, because a
 * failed charge is the one somebody asks about. Each write is an upsert on
 * Stripe's invoice id: the same invoice arrives on more than one event type,
 * events are delivered at least once, and they are not ordered, so a second
 * copy must update the row rather than add another.
 */

export interface InvoiceRecord {
  id: string;
  stripe_invoice_id: string;
  number: string | null;
  status: string;
  amount_due_cents: number | null;
  amount_paid_cents: number | null;
  currency: string | null;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf_url: string | null;
  issued_at: string | null;
  paid_at: string | null;
  failure_reason: string | null;
}

export interface InvoiceInput {
  orgId: string;
  stripeInvoiceId: string;
  number?: string | null;
  status: string;
  amountDueCents?: number | null;
  amountPaidCents?: number | null;
  currency?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  hostedInvoiceUrl?: string | null;
  invoicePdfUrl?: string | null;
  issuedAt?: string | null;
  paidAt?: string | null;
  failureReason?: string | null;
}

/**
 * Record one invoice.
 *
 * Never throws. A webhook that could not file a receipt must still finish
 * updating the subscription state, because the alternative is Stripe retrying
 * the event and the account's access staying wrong in the meantime.
 */
export async function recordInvoice(input: InvoiceInput): Promise<void> {
  await query(
    `insert into billing_invoices
       (org_id, stripe_invoice_id, number, status, amount_due_cents,
        amount_paid_cents, currency, period_start, period_end,
        hosted_invoice_url, invoice_pdf_url, issued_at, paid_at, failure_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (stripe_invoice_id) do update set
       number             = coalesce(excluded.number, billing_invoices.number),
       status             = excluded.status,
       amount_due_cents   = coalesce(excluded.amount_due_cents, billing_invoices.amount_due_cents),
       amount_paid_cents  = coalesce(excluded.amount_paid_cents, billing_invoices.amount_paid_cents),
       currency           = coalesce(excluded.currency, billing_invoices.currency),
       period_start       = coalesce(excluded.period_start, billing_invoices.period_start),
       period_end         = coalesce(excluded.period_end, billing_invoices.period_end),
       hosted_invoice_url = coalesce(excluded.hosted_invoice_url, billing_invoices.hosted_invoice_url),
       invoice_pdf_url    = coalesce(excluded.invoice_pdf_url, billing_invoices.invoice_pdf_url),
       issued_at          = coalesce(excluded.issued_at, billing_invoices.issued_at),
       paid_at            = coalesce(excluded.paid_at, billing_invoices.paid_at),
       -- Cleared on a payment that went through, kept otherwise. A receipt
       -- that still carries the reason a previous attempt failed reads as a
       -- charge that failed.
       failure_reason     = case when excluded.status = 'paid' then null
                                 else coalesce(excluded.failure_reason, billing_invoices.failure_reason) end,
       updated_at         = now()`,
    [
      input.orgId,
      input.stripeInvoiceId,
      input.number ?? null,
      input.status,
      input.amountDueCents ?? null,
      input.amountPaidCents ?? null,
      input.currency ?? null,
      input.periodStart ?? null,
      input.periodEnd ?? null,
      input.hostedInvoiceUrl ?? null,
      input.invoicePdfUrl ?? null,
      input.issuedAt ?? null,
      input.paidAt ?? null,
      input.failureReason ?? null,
    ]
  ).catch((e: unknown) => {
    console.warn("[billing] could not record an invoice:", e);
  });
}

/** The account's invoices, newest first. Scoped to one org, always. */
export async function invoicesFor(orgId: string, limit = 12): Promise<InvoiceRecord[]> {
  return query<InvoiceRecord>(
    `select id, stripe_invoice_id, number, status, amount_due_cents,
            amount_paid_cents, currency,
            period_start::text as period_start, period_end::text as period_end,
            hosted_invoice_url, invoice_pdf_url,
            issued_at::text as issued_at, paid_at::text as paid_at,
            failure_reason
       from billing_invoices
      where org_id = $1
      order by issued_at desc nulls last, created_at desc
      limit $2`,
    [orgId, limit]
  ).catch(() => []);
}

/** Save the card Stripe last reported for an account. Never throws. */
export async function recordPaymentMethod(
  orgId: string,
  card: { brand?: string | null; last4?: string | null; expMonth?: number | null; expYear?: number | null } | null
): Promise<void> {
  if (!card || !card.last4) return;
  await query(
    `update organizations
        set card_brand = $2, card_last4 = $3,
            card_exp_month = $4, card_exp_year = $5,
            card_recorded_at = now(), updated_at = now()
      where id = $1`,
    [orgId, card.brand ?? null, card.last4, card.expMonth ?? null, card.expYear ?? null]
  ).catch((e: unknown) => {
    console.warn("[billing] could not record a payment method:", e);
  });
}
