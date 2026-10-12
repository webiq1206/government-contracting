import { query, transaction } from "../db";
import { decimalUnits, validateCost } from "./money";
import { platformApiValue } from "./credentials";
import { BILLABLE_PROVIDERS } from "./providers";
import { createHash } from "node:crypto";
type TwilioSnapshot = {
  id: string;
  org_id: string;
  provider: string;
  credential_source: string;
  credential_fingerprint: string;
  provider_request_id: string;
  provider_cost: string | null;
  budget_cost: string | null;
  reserved_cost: string | null;
  billing_accepted: boolean;
  billing_status: string;
  batch_id: string | null;
  invoice_reference: string | null;
  outcome: string;
  evidence: string | null;
};
const snapshotFields = [
  "id", "org_id", "provider", "credential_source", "credential_fingerprint",
  "provider_request_id", "provider_cost", "budget_cost", "reserved_cost",
  "billing_accepted", "billing_status", "batch_id", "invoice_reference",
  "outcome", "evidence",
] as const;
const snapshotColumns = snapshotFields.join(",");
const snapshotDigest = (row: TwilioSnapshot) => createHash("sha256")
  .update(JSON.stringify(snapshotFields.map(key => row[key]))).digest("hex");

/** Private to the adapter: request JSON cannot supply a verified receipt.
 * The snapshot detects changed state; account verification happens at lookup.
 * Cost and its audit commit together. No work receipt or executor is changed. */
async function commitTwilioReceipt(expected: TwilioSnapshot, accountSid: string, cost: string) {
  const receiptId = createHash("sha256").update(JSON.stringify([
    "twilio-receipt-v1", expected.id, expected.org_id,
    expected.credential_source, expected.credential_fingerprint,
    accountSid, expected.provider_request_id, "USD", decimalUnits(cost).toString(),
  ])).digest("hex");
  const evidence = `Automatic: Twilio message ${expected.provider_request_id}`;
  return transaction(async (c) => {
    await c.query("select pg_advisory_xact_lock(hashtext('api-usage-admission'))");
    const row: TwilioSnapshot | undefined = (await c.query(
      `select ${snapshotColumns} from api_usage_events where id=$1 for update`, [expected.id],
    )).rows[0];
    if (!row || !row.org_id || row.org_id !== expected.org_id || row.provider !== "Twilio" ||
        row.credential_source !== "platform" ||
        row.credential_fingerprint !== expected.credential_fingerprint ||
        row.provider_request_id !== expected.provider_request_id)
      throw new Error("Twilio receipt identity changed during lookup. Review the usage record.");
    const duplicates = (await c.query(
      "select id from api_usage_events where provider=$1 and provider_request_id=$2 and id<>$3",
      ["Twilio", row.provider_request_id, row.id],
    )).rows;
    if (duplicates.length) throw new Error("Duplicate provider request needs investigation.");
    if (row.provider_cost != null) {
      if (decimalUnits(row.provider_cost) !== decimalUnits(cost))
        throw new Error("A confirmed provider cost cannot be overwritten. Review the conflicting receipt.");
      const committed = (await c.query(
        "select 1 from api_usage_audit where org_id=$1 and action='provider_receipt' and details->>'receiptId'=$2 limit 1",
        [row.org_id, receiptId],
      )).rows.length > 0;
      // A retry can arrive after invoicing. It may acknowledge the identical
      // committed receipt, but never rewrite cost, evidence or billing state.
      if (committed && row.evidence === evidence) return false;
      throw new Error("This cost has different evidence. Review the usage record.");
    }
    if (snapshotDigest(row) !== snapshotDigest(expected))
      throw new Error("Usage state changed during receipt lookup. Review before retrying.");
    if (row.batch_id || row.invoice_reference || row.outcome === "pending" ||
        !["unbilled", "review", "not_billable"].includes(row.billing_status))
      throw new Error("This usage is not eligible for cost reconciliation.");
    const billingStatus = row.billing_accepted ? "unbilled" : "review";
    await c.query(
      "update api_usage_events set provider_cost=$2,evidence=$3,billing_status=$4 where id=$1",
      [row.id, cost, evidence, billingStatus],
    );
    await c.query(
      "insert into api_usage_audit(org_id,actor,action,details) values($1,'provider reconciliation','provider_receipt',$2)",
      [row.org_id, JSON.stringify({
        receiptId, id: row.id, provider: "Twilio", accountSid,
        requestId: row.provider_request_id, currency: "USD", cost, evidence,
        before: { providerCost: row.provider_cost, billingStatus: row.billing_status },
        after: { providerCost: cost, billingStatus },
      })],
    );
    return true;
  });
}
export async function syncAnthropicCosts() {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY;
  if (!key)
    throw new Error(
      "Add ANTHROPIC_ADMIN_API_KEY to connect provider billing reports.",
    );
  const end = new Date(new Date().toISOString().slice(0, 10));
  const start = new Date(+end - 7 * 86400000);
  let page: string | undefined;
  const seen = new Set<string>();
  const buckets: {
    starting_at: string;
    ending_at: string;
    results: { amount: string; currency: string }[];
  }[] = [];
  do {
    const u = new URL("https://api.anthropic.com/v1/organizations/cost_report");
    u.searchParams.set("starting_at", start.toISOString());
    u.searchParams.set("ending_at", end.toISOString());
    u.searchParams.set("limit", "31");
    if (page) u.searchParams.set("page", page);
    const r = await fetch(u, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok)
      throw new Error(
        `Anthropic billing report returned HTTP ${r.status}. Check the billing credential.`,
      );
    const body = await r.json();
    if (!Array.isArray(body.data))
      throw new Error("Unexpected provider report.");
    buckets.push(...body.data);
    page = body.has_more ? body.next_page : undefined;
    if (body.has_more && (!page || seen.has(page) || seen.size >= 30))
      throw new Error(
        "Incomplete provider pagination. Nothing was reconciled.",
      );
    if (page) seen.add(page);
  } while (page);
  await transaction(async (c) => {
    for (const b of buckets) {
      for (const r of b.results) {
        if (r.currency.toUpperCase() !== "USD")
          throw new Error("Only USD provider costs are supported.");
        validateCost(r.amount);
      }
      // Anthropic reports decimal cents. Convert in SQL, without binary rounding.
      await c.query(
        `insert into api_usage_provider_reports(provider,starts_at,ends_at,reported_cost,tracked_cost,unknown_calls,evidence)
   select 'Anthropic',$1::timestamptz,$2::timestamptz,(select coalesce(sum(value::numeric),0)/100 from jsonb_array_elements_text($3::jsonb)),coalesce(sum(provider_cost),0),count(*) filter(where provider_cost is null),'Automatic: Anthropic organization cost report (entire provider account)'
   from api_usage_events where provider='Anthropic' and credential_source='platform' and started_at >=$1::timestamptz and started_at<$2::timestamptz
   on conflict(provider,starts_at,ends_at) where evidence like 'Automatic:%' do update set reported_cost=excluded.reported_cost,tracked_cost=excluded.tracked_cost,unknown_calls=excluded.unknown_calls,created_at=now()`,
        [
          b.starting_at,
          b.ending_at,
          JSON.stringify(b.results.map((r) => r.amount)),
        ],
      );
    }
  });
  return buckets.length;
}
export async function syncTwilioCosts() {
  const [sid, token] = await Promise.all([
    platformApiValue("TWILIO_ACCOUNT_SID"),
    platformApiValue("TWILIO_AUTH_TOKEN"),
  ]);
  if (!sid || !token)
    throw new Error("Connect platform Twilio credentials first.");
  const fingerprint = createHash("sha256").update(token).digest("hex");
  const rows = await query<TwilioSnapshot>(
    `select ${snapshotColumns} from api_usage_events where provider='Twilio' and org_id is not null and credential_source='platform' and provider_cost is null and batch_id is null and invoice_reference is null and outcome<>'pending' and billing_status in ('unbilled','review','not_billable') and credential_fingerprint=$1 and provider_request_id is not null order by last_reconciled_at nulls first,started_at limit 100`,
    [fingerprint],
  );
  let count = 0;
  for (const row of rows) {
    await query(
      "update api_usage_events set last_reconciled_at=now() where id=$1",
      [row.id],
    );
    if (!/^SM[0-9a-f]{32}$/i.test(row.provider_request_id)) continue;
    const u = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages/${row.provider_request_id}.json`;
    const response = await fetch(u, {
      headers: {
        Authorization:
          "Basic " + Buffer.from(sid + ":" + token).toString("base64"),
      },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok)
      throw new Error(
        `Twilio billing lookup returned HTTP ${response.status}.`,
      );
    const body = await response.json();
    if (body.sid !== row.provider_request_id || body.account_sid !== sid)
      throw new Error("Twilio receipt account mismatch.");
    if (body.price == null || body.price_unit?.toUpperCase() !== "USD")
      continue;
    const cost = String(body.price).replace(/^-/, "");
    validateCost(cost);
    if (await commitTwilioReceipt(row, sid, cost)) count++;
  }
  return count;
}
export async function syncProviderCosts(provider: string) {
  try {
    const count =
      provider === "Anthropic"
        ? await syncAnthropicCosts()
        : provider === "Twilio"
          ? await syncTwilioCosts()
          : (() => {
              throw new Error("No verified request-cost adapter is available for this provider.");
            })();
    await query(
      "insert into api_usage_sync_runs(provider,status,detail) values($1,'complete',$2)",
      [provider, `${count} provider records synchronized.`],
    );
    return count;
  } catch (e) {
    await query(
      "insert into api_usage_sync_runs(provider,status,detail) values($1,'attention',$2)",
      [provider, (e as Error).message],
    );
    throw e;
  }
}

/** Additional services can supply attributable receipts without inventing per-request infrastructure costs. */
export async function importExternalUsage(
  records: {
    id: string;
    orgId: string;
    provider: string;
    service: string;
    feature: string;
    requestId: string;
    occurredAt: string;
    cost: string;
    source: "platform" | "tenant";
    envKey?: string;
    evidence: string;
  }[],
  actor: string,
) {
  return transaction(async (c) => {
    for (const r of records) {
      validateCost(r.cost);
      await c.query(
        "select pg_advisory_xact_lock(hashtext('external-usage:'||$1))",
        [r.provider + ":" + r.requestId],
      );
      const existing = (
        await c.query(
          "select id from api_usage_events where id=$1 or (provider=$2 and provider_request_id=$3)",
          [r.id, r.provider, r.requestId],
        )
      ).rows;
      if (existing.length)
        throw new Error(
          "This receipt already exists. Review its recorded entry; importing new usage cannot settle it.",
        );
      const acceptance =
        (
          await c.query(
            "select 1 from api_usage_preferences where org_id=$1 and env_key=$2 and source='platform' and accepted_at<=$3::timestamptz",
            [r.orgId, r.envKey ?? "", r.occurredAt],
          )
        ).rows.length > 0;
      const providerMatches = BILLABLE_PROVIDERS.some(
        (p) => p.provider === r.provider && p.key === r.envKey,
      );
      const billable =
        r.source === "platform" &&
        providerMatches &&
        acceptance &&
        r.orgId !== "00000000-0000-4000-8000-000000000001";
      await c.query(
        `insert into api_usage_events(id,org_id,provider,service,feature,credential_source,credential_fingerprint,billing_accepted,started_at,finished_at,outcome,provider_request_id,usage,provider_cost,evidence,billing_status)
    values($1,$2,$3,$4,$5,$6,'provider receipt',$7,$8,$8,'success',$9,'{"requests":1}',$10,$11,$12)`,
        [
          r.id,
          r.orgId,
          r.provider,
          r.service,
          r.feature,
          r.source,
          billable,
          r.occurredAt,
          r.requestId,
          r.cost,
          r.evidence,
          r.source === "tenant"
            ? "not_billable"
            : billable
              ? "unbilled"
              : "review",
        ],
      );
      await c.query(
        "insert into api_usage_audit(org_id,actor,action,details) values($1,$2,'external_usage_imported',$3)",
        [
          r.orgId,
          actor,
          JSON.stringify({
            id: r.id,
            provider: r.provider,
            evidence: r.evidence,
          }),
        ],
      );
    }
    return records.length;
  });
}
