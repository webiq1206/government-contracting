import { queryOne } from "../db";
import { LEGACY_ORG_ID } from "../tenant-context";
import { safeRequestId } from "../api-usage/diagnostics";

export const RECONCILIATION_ROW_LIMIT = 100;

type HeldEvent = {
  id: string; provider: string; service: string; outcome: string;
  credential_source: string; currency: string;
  started_at: string; finished_at: string | null;
  reserved_cost: string; budget_cost: string | null; provider_cost: string | null;
  provider_request_id: string | null; http_error: string | null;
};
type PendingReceipt = {
  receipt_reference: string; identity: string; state: string;
  started_at: string; completed_at: string | null; has_saved_result: boolean;
};
type Snapshot = {
  observed_at: string;
  held_total: number; held_reserved_total: string; held: HeldEvent[];
  pending_total: number; pending: PendingReceipt[];
};

/** One database snapshot, all dates, metadata only. Never resolves credentials,
 * contacts a provider, guesses a receipt join, settles a hold or replays work. */
export async function readAiReconciliation() {
  const snapshot = await queryOne<Snapshot>(`with held as (
    select id::text, provider, service, outcome, credential_source, currency,
      started_at, finished_at, reserved_cost, budget_cost, provider_cost,
      provider_request_id,
      case when error_code ~ '^HTTP [45][0-9]{2}$' then error_code else null end as http_error
    from api_usage_events
    where org_id=$1 and provider_cost is null and budget_cost is null and reserved_cost>0
  ), pending as (
    select work_key as receipt_reference,
      case when scope_key like 'v2:%' then 'provider_independent' else 'legacy' end as identity,
      state, started_at, completed_at, result is not null as has_saved_result
    from ai_work_receipts where org_id=$1 and state='pending'
  ) select now()::text as observed_at,
    (select count(*)::int from held) as held_total,
    (select coalesce(sum(reserved_cost),0)::text from held) as held_reserved_total,
    coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at,r.id) from (
      select id,provider,service,outcome,credential_source,currency,
        started_at::text,finished_at::text,reserved_cost::text,budget_cost::text,provider_cost::text,
        provider_request_id,http_error from held order by started_at,id limit $2
    ) r),'[]'::jsonb) as held,
    (select count(*)::int from pending) as pending_total,
    coalesce((select jsonb_agg(to_jsonb(r) order by r.started_at,r.receipt_reference) from (
      select receipt_reference,identity,state,started_at::text,completed_at::text,has_saved_result
      from pending order by started_at,receipt_reference limit $2
    ) r),'[]'::jsonb) as pending`, [LEGACY_ORG_ID, RECONCILIATION_ROW_LIMIT]);
  if (!snapshot) throw new Error("Reconciliation inventory is unavailable.");

  return {
    observedAt: snapshot.observed_at,
    organizationId: LEGACY_ORG_ID,
    scope: "All dates; held spending reservations and pending AI work receipts only.",
    heldReservations: {
      total: snapshot.held_total,
      returned: snapshot.held.length,
      truncated: snapshot.held_total > snapshot.held.length,
      reservedTotalUsd: snapshot.held_reserved_total,
      rows: snapshot.held.map(row => ({
        eventId: row.id, provider: row.provider, model: row.service, outcome: row.outcome,
        credentialSource: row.credential_source, currency: row.currency,
        startedAt: row.started_at, finishedAt: row.finished_at,
        reservedCost: row.reserved_cost, budgetCost: row.budget_cost, providerCost: row.provider_cost,
        providerRequestId: safeRequestId(row.provider_request_id),
        providerRequestIdOmitted: row.provider_request_id != null && safeRequestId(row.provider_request_id) == null,
        httpError: row.http_error,
        linkageStatus: "not_recorded",
        linkedReceiptReference: null,
      })),
    },
    pendingWorkReceipts: {
      total: snapshot.pending_total,
      returned: snapshot.pending.length,
      truncated: snapshot.pending_total > snapshot.pending.length,
      rows: snapshot.pending.map(row => ({
        receiptReference: /^[a-f0-9]{64}$/.test(row.receipt_reference) ? row.receipt_reference : null,
        receiptReferenceOmitted: !/^[a-f0-9]{64}$/.test(row.receipt_reference),
        identity: row.identity, state: row.state, startedAt: row.started_at,
        completedAt: row.completed_at, hasSavedResult: row.has_saved_result,
        linkageStatus: "not_recorded",
        linkedEventId: null,
      })),
    },
    reconciliation: "No persisted receipt-to-usage relationship exists. Similar counts, times or amounts do not establish a match. Preserve uncertain holds; do not replay work.",
    spendingAuthorization: "This read does not authorize additional provider calls or spending.",
  };
}
