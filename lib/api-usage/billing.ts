import { query, queryOne, transaction } from "../db";
import { getStripe } from "../billing/stripe";
import { createUsageInvoice } from "./invoice";
/** Stripe subscription item periods are authoritative; never infer an anniversary. */
export async function syncBillingPeriod(orgId: string) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not connected.");
  const org = await queryOne<{ stripe_subscription_id: string }>(
    "select stripe_subscription_id from organizations where id=$1",
    [orgId],
  );
  if (!org?.stripe_subscription_id)
    throw new Error("No subscription billing period is available.");
  const sub = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
  const items = sub.items?.data ?? [];
  const start = sub.current_period_start ?? items[0]?.current_period_start;
  const end = sub.current_period_end ?? items[0]?.current_period_end;
  if (
    !start ||
    !end ||
    end <= start ||
    items.some(
      (i: { current_period_start?: number; current_period_end?: number }) =>
        (i.current_period_start && i.current_period_start !== start) ||
        (i.current_period_end && i.current_period_end !== end),
    )
  )
    throw new Error(
      "The subscription has no single billing period. Review billing in Stripe.",
    );
  await query(
    `insert into api_usage_billing_periods(org_id,subscription_id,starts_at,ends_at) values($1,$2,to_timestamp($3),to_timestamp($4)) on conflict(org_id,starts_at) do update set ends_at=excluded.ends_at`,
    [orgId, sub.id, start, end],
  );
  return {
    start: new Date(start * 1000).toISOString(),
    end: new Date(end * 1000).toISOString(),
  };
}
export async function finalizeUsageInvoice(
  orgId: string,
  batchId: string,
  actor: string,
) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not connected.");
  const b = await queryOne<{
    stripe_invoice_id: string;
    stripe_item_id: string;
    status: string;
  }>(
    "select stripe_invoice_id,stripe_item_id,status from api_usage_invoice_batches where id=$1 and org_id=$2",
    [batchId, orgId],
  );
  if (!b?.stripe_invoice_id || !b.stripe_item_id || b.status === "preparing")
    throw new Error("Finish preparing this invoice first.");
  const invoice = await stripe.invoices.retrieve(b.stripe_invoice_id);
  if (
    invoice.metadata?.org_id !== orgId ||
    invoice.metadata?.api_usage_batch !== batchId
  )
    throw new Error(
      "Stripe invoice ownership does not match this usage batch.",
    );
  if (invoice.status === "draft")
    await stripe.invoices.finalizeInvoice(
      invoice.id,
      { auto_advance: true },
      { idempotencyKey: `usage-finalize-${batchId}` },
    );
  else if (!["open", "paid"].includes(invoice.status))
    throw new Error(
      "This invoice cannot be collected. Review its status in Stripe.",
    );
  await query(
    "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,'invoice_collection_requested',$3)",
    [orgId, actor, JSON.stringify({ batchId, invoice: invoice.id })],
  );
  return invoice.id;
}
/** A durable adjustment id survives network timeouts; retries cannot double-refund. */
export async function adjustUsageInvoice(
  input: {
    id: string;
    orgId: string;
    batchId: string;
    amountCents: number;
    kind: "credit" | "refund";
    reason: string;
  },
  actor: string,
) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not connected.");
  const a = await transaction(async (c) => {
    await c.query(
      "select pg_advisory_xact_lock(hashtext('usage-adjustment:'||$1))",
      [input.batchId],
    );
    const existing = (
      await c.query("select * from api_usage_adjustments where id=$1", [
        input.id,
      ])
    ).rows[0];
    if (existing) {
      if (
        existing.org_id !== input.orgId ||
        existing.batch_id !== input.batchId ||
        Number(existing.amount_cents) !== input.amountCents ||
        existing.kind !== input.kind
      )
        throw new Error("This adjustment id belongs to a different request.");
      return existing;
    }
    const b = (
      await c.query(
        "select * from api_usage_invoice_batches where id=$1 and org_id=$2 for update",
        [input.batchId, input.orgId],
      )
    ).rows[0];
    if (!b || !["open", "paid"].includes(b.status))
      throw new Error("Only finalized invoices can be credited or refunded.");
    const reserved = (
      await c.query(
        "select coalesce(sum(amount_cents),0)::text total from api_usage_adjustments where batch_id=$1",
        [input.batchId],
      )
    ).rows[0];
    if (
      BigInt(reserved.total) + BigInt(input.amountCents) >
      BigInt(b.amount_cents)
    )
      throw new Error("This exceeds the remaining adjustable amount.");
    return (
      await c.query(
        `insert into api_usage_adjustments(id,org_id,batch_id,amount_cents,kind,reason,actor) values($1,$2,$3,$4,$5,$6,$7) returning *`,
        [
          input.id,
          input.orgId,
          input.batchId,
          input.amountCents,
          input.kind,
          input.reason,
          actor,
        ],
      )
    ).rows[0];
  });
  if (a.stripe_credit_note_id) return a.stripe_credit_note_id;
  if (Date.now() - new Date(a.created_at).getTime() > 20 * 3600000)
    throw new Error(
      "This older attempt needs review in Stripe before retrying.",
    );
  const b = await queryOne<{ stripe_invoice_id: string }>(
    "select stripe_invoice_id from api_usage_invoice_batches where id=$1",
    [a.batch_id],
  );
  const invoice = await stripe.invoices.retrieve(b!.stripe_invoice_id);
  if (
    invoice.metadata?.org_id !== a.org_id ||
    invoice.metadata?.api_usage_batch !== a.batch_id
  )
    throw new Error(
      "Stripe invoice ownership does not match this usage batch.",
    );
  if (!["open", "paid"].includes(invoice.status))
    throw new Error("The current Stripe invoice cannot be adjusted.");
  if (input.kind === "refund" && invoice.status !== "paid")
    throw new Error("Only paid invoices can be refunded.");
  const postPayment = Math.max(
    0,
    Number(a.amount_cents) - Number(invoice.amount_remaining),
  );
  const note = await stripe.creditNotes.create(
    {
      invoice: invoice.id,
      amount: Number(a.amount_cents),
      memo: a.reason,
      ...(postPayment
        ? {
            [a.kind === "refund" ? "refund_amount" : "credit_amount"]:
              postPayment,
          }
        : {}),
      metadata: { api_usage_adjustment: a.id, org_id: a.org_id },
    },
    { idempotencyKey: `usage-adjustment-${a.id}` },
  );
  await transaction(async (c) => {
    await c.query(
      "update api_usage_adjustments set stripe_credit_note_id=$2,status='complete',settlement_status=case when kind='refund' then 'submitted' else 'credited' end where id=$1",
      [a.id, note.id],
    );
    await c.query(
      "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,$3,$4)",
      [
        a.org_id,
        actor,
        `invoice_${a.kind}`,
        JSON.stringify({
          adjustmentId: a.id,
          creditNote: note.id,
          amountCents: a.amount_cents,
        }),
      ],
    );
  });
  return note.id;
}
export async function billDueUsage() {
  const settings = await query<{ org_id: string; enabled_at: string }>(
    "select org_id,enabled_at::text from api_usage_billing_settings where automatic",
  );
  for (const setting of settings) {
    try {
      await syncBillingPeriod(setting.org_id);
      const periods = await query<{ starts_at: string; ends_at: string }>(
        "select starts_at::text,ends_at::text from api_usage_billing_periods where org_id=$1 and ends_at<=now()-interval '2 days' and ends_at>$2::timestamptz order by ends_at desc limit 1",
        [setting.org_id, setting.enabled_at],
      );
      if (!periods[0]) continue;
      const p = periods[0];
      const drafts = await query<{ id: string }>(
        "select id from api_usage_invoice_batches where org_id=$1 and status='draft' and period_end is not null",
        [setting.org_id],
      );
      for (const draft of drafts)
        await finalizeUsageInvoice(
          setting.org_id,
          draft.id,
          "scheduled billing",
        );
      const ready = await queryOne<{ count: number }>(
        "select count(*)::int count from api_usage_events where org_id=$1 and started_at<$2::timestamptz and billing_status='unbilled' and batch_id is null",
        [setting.org_id, p.ends_at],
      );
      if (!ready?.count) continue;
      const invoice = await createUsageInvoice(
        setting.org_id,
        "scheduled billing",
        { start: p.starts_at, end: p.ends_at },
      );
      const batch = await queryOne<{ id: string }>(
        "select id from api_usage_invoice_batches where stripe_invoice_id=$1",
        [invoice],
      );
      await finalizeUsageInvoice(
        setting.org_id,
        batch!.id,
        "scheduled billing",
      );
    } catch (e) {
      await query(
        "insert into api_usage_sync_runs(provider,status,detail) values('Billing','attention',$1)",
        [`Account ${setting.org_id}: ${(e as Error).message}`],
      );
    }
  }
}

/** Read Stripe's outcome, or attach the proven result of an interrupted write. */
export async function syncUsageAdjustment(id: string, creditNoteId?: string) {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not connected.");
  const a = await queryOne<{
    id: string;
    org_id: string;
    batch_id: string;
    amount_cents: string;
    kind: string;
    stripe_credit_note_id: string;
  }>("select * from api_usage_adjustments where id=$1", [id]);
  if (!a) throw new Error("Adjustment not found.");
  const ref = creditNoteId ?? a.stripe_credit_note_id;
  if (!ref || (a.stripe_credit_note_id && a.stripe_credit_note_id !== ref))
    throw new Error("Choose the matching Stripe credit note.");
  const note = await stripe.creditNotes.retrieve(ref);
  const b = await queryOne<{ stripe_invoice_id: string }>(
    "select stripe_invoice_id from api_usage_invoice_batches where id=$1 and org_id=$2",
    [a.batch_id, a.org_id],
  );
  const invoiceId =
    typeof note.invoice === "string" ? note.invoice : note.invoice?.id;
  if (
    note.metadata?.api_usage_adjustment !== a.id ||
    note.metadata?.org_id !== a.org_id ||
    invoiceId !== b?.stripe_invoice_id ||
    String(note.amount) !== String(a.amount_cents)
  )
    throw new Error("This credit note does not match the recorded adjustment.");
  let settlement =
    note.status === "void"
      ? "voided"
      : a.kind === "credit"
        ? "credited"
        : "submitted";
  if (a.kind === "refund" && note.status !== "void") {
    const refunds = await Promise.all(
      (note.refunds ?? []).map((r: { refund: string | { id: string } }) =>
        stripe.refunds.retrieve(
          typeof r.refund === "string" ? r.refund : r.refund.id,
        ),
      ),
    );
    if (refunds.length)
      settlement = refunds.some((r: { status: string }) =>
        ["failed", "canceled"].includes(r.status),
      )
        ? "failed"
        : refunds.every((r: { status: string }) => r.status === "succeeded")
          ? "refunded"
          : "pending";
  }
  await query(
    "update api_usage_adjustments set stripe_credit_note_id=$2,status='complete',settlement_status=$3,last_checked_at=now() where id=$1",
    [a.id, ref, settlement],
  );
  return settlement;
}
export async function syncUsageAdjustments() {
  const rows = await query<{ id: string }>(
    "select id from api_usage_adjustments where stripe_credit_note_id is not null order by last_checked_at nulls first,created_at limit 100",
  );
  for (const a of rows)
    try {
      await syncUsageAdjustment(a.id);
    } catch (e) {
      await query(
        "insert into api_usage_sync_runs(provider,status,detail) values('Adjustments','attention',$1)",
        [(e as Error).message],
      );
    }
}
