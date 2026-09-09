import { query, transaction } from "../db";
import { getStripe } from "../billing/stripe";
/** Snapshot confirmed unbilled usage. Exact totals carry rounding differences to later bills. */
export async function createUsageInvoice(
  orgId: string,
  actor: string,
  period?: { start: string; end: string },
): Promise<string> {
  const stripe = getStripe();
  if (!stripe)
    throw new Error("Stripe is not connected. No invoice was created.");
  const batch = await transaction(async (client) => {
    await client.query(
      "select pg_advisory_xact_lock(hashtext('api-usage-invoice:'||$1))",
      [orgId],
    );
    const { rows: orgs } = await client.query(
      "select stripe_customer_id from organizations where id=$1",
      [orgId],
    );
    const customer = orgs[0]?.stripe_customer_id;
    if (!customer)
      throw new Error("This tenant has no Stripe billing account.");
    const { rows: pending } = await client.query(
      "select * from api_usage_invoice_batches where org_id=$1 and status='preparing'",
      [orgId],
    );
    if (pending[0]) {
      if (period && !pending[0].period_end)
        throw new Error(
          "A manually prepared invoice needs review before scheduled billing can continue.",
        );
      return { ...pending[0], customer };
    }
    const { rows: events } = await client.query(
      `select id from api_usage_events where org_id=$1 and billing_status='unbilled' and batch_id is null
      and billing_accepted and credential_source='platform' and provider_cost is not null
      and ($2::timestamptz is null or started_at < $2::timestamptz) order by id for update`,
      [orgId, period?.end ?? null],
    );
    if (!events.length)
      throw new Error("No confirmed, unbilled usage is ready.");
    const eventIds = events.map((e) => e.id);
    const { rows: totals } = await client.query(
      "select sum(tenant_charge)::text as exact from api_usage_events where id=any($1::uuid[])",
      [eventIds],
    );
    // Do not invoice a duplicate provider response, even if a prior reconciliation was approved.
    const { rows: duplicates } = await client.query(
      `select 1 from api_usage_events e where org_id=$1 and billing_status='unbilled'
      and provider_request_id is not null and exists(select 1 from api_usage_events d
      where d.provider=e.provider and d.provider_request_id=e.provider_request_id and d.id<>e.id) limit 1`,
      [orgId],
    );
    if (duplicates.length)
      throw new Error(
        "Resolve duplicate provider requests before creating this invoice.",
      );
    const { rows: amounts } = await client.query(
      `select round(($2::numeric+coalesce(sum(exact_amount-amount_cents::numeric/100),0))*100)::text as cents
      from api_usage_invoice_batches where org_id=$1`,
      [orgId, totals[0].exact],
    );
    const cents = Number(amounts[0].cents);
    if (!Number.isSafeInteger(cents) || cents < 1)
      throw new Error(
        "Usage is below one cent. It stays unbilled and carries forward.",
      );
    const { rows: batches } = await client.query(
      `insert into api_usage_invoice_batches(org_id,exact_amount,amount_cents) values($1,$2,$3) returning *`,
      [orgId, totals[0].exact, cents],
    );
    const b = batches[0];
    if (period) {
      await client.query(
        "update api_usage_invoice_batches set period_start=$2,period_end=$3 where id=$1",
        [b.id, period.start, period.end],
      );
      b.period_start = period.start;
      b.period_end = period.end;
    }
    await client.query(
      `update api_usage_events set batch_id=$2,billing_status='pending' where id=any($1::uuid[])`,
      [eventIds, b.id],
    );
    await client.query(
      "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,$3,$4)",
      [
        orgId,
        actor,
        "invoice_prepared",
        JSON.stringify({ batchId: b.id, cents }),
      ],
    );
    return { ...b, customer };
  });
  // Stripe idempotency keys expire. Do not blindly repeat an ambiguous old write.
  if (Date.now() - new Date(batch.created_at).getTime() > 20 * 3600000)
    throw new Error(
      "An older invoice attempt needs review in Stripe before retrying. No new invoice was created.",
    );
  let invoiceId = batch.stripe_invoice_id as string | null;
  if (!invoiceId) {
    const invoice = await stripe.invoices.create(
      {
        customer: batch.customer,
        auto_advance: false,
        pending_invoice_items_behavior: "exclude",
        description: "API service usage",
        metadata: { api_usage_batch: batch.id, org_id: orgId },
      },
      { idempotencyKey: `api-usage-invoice-${batch.id}` },
    );
    invoiceId = invoice.id;
    await query(
      "update api_usage_invoice_batches set stripe_invoice_id=$2 where id=$1",
      [batch.id, invoiceId],
    );
  }
  const item = await stripe.invoiceItems.create(
    {
      customer: batch.customer,
      invoice: invoiceId,
      currency: "usd",
      amount: Number(batch.amount_cents),
      description:
        batch.period_start && batch.period_end
          ? `API service usage through ${new Date(batch.period_end).toISOString().slice(0, 10)} (including confirmed carry-forward)`
          : "API services used by your account",
      ...(batch.period_start && batch.period_end
        ? {
            period: {
              start: Math.floor(new Date(batch.period_start).getTime() / 1000),
              end: Math.floor(new Date(batch.period_end).getTime() / 1000),
            },
          }
        : {}),
      discountable: false,
      metadata: { api_usage_batch: batch.id },
    },
    { idempotencyKey: `api-usage-item-${batch.id}` },
  );
  await transaction(async (client) => {
    await client.query(
      "update api_usage_invoice_batches set stripe_item_id=$2,status=case when status='preparing' then 'draft' else status end where id=$1",
      [batch.id, item.id],
    );
    await client.query(
      "update api_usage_events set invoice_reference=$2 where batch_id=$1",
      [batch.id, invoiceId],
    );
  });
  return invoiceId!;
}
