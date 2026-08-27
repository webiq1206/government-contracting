import { query, queryOne } from "@/lib/db";
import { listSettings } from "@/lib/integration-settings";
import { integrationState, type IntegrationVerdict } from "@/lib/domain/integration-state";
import { INTEGRATION_DEFS } from "@/lib/integration-defs";

/**
 * What one customer account has actually done, and what it is running on.
 *
 * Read only when a platform administrator opens that account, never in a
 * list: these are per-account aggregates and doing them for every row is how
 * an admin page becomes the slowest thing in the product.
 *
 * Every count can be absent. A query that fails returns null rather than
 * zero, because "this account has sent no outreach" and "we could not read
 * the outreach table" lead to opposite conversations with a customer.
 */

export interface AccountUsage {
  opportunities: number | null;
  pursued: number | null;
  bids: number | null;
  submitted: number | null;
  contracts: number | null;
  subcontractors: number | null;
  outreachSent: number | null;
  repliesIn: number | null;
  documents: number | null;
  /** Bytes across every file this account has stored, when it can be read. */
  storageBytes: number | null;
  /** The newest record of any kind, which is a truer "last used" than a login. */
  lastRecordAt: string | null;
}

export async function accountUsage(orgId: string): Promise<AccountUsage> {
  const row = await queryOne<Record<string, string | null>>(
    `select
       (select count(*) from opportunities where org_id = $1) as opportunities,
       (select count(*) from opportunities where org_id = $1 and stage in ('analysis','sub_research','outreach','call_queue','quote_entry','bid_building','review_submit','submitted','won')) as pursued,
       (select count(*) from bids where org_id = $1) as bids,
       (select count(*) from bids where org_id = $1 and submitted_at is not null) as submitted,
       (select count(*) from contracts where org_id = $1) as contracts,
       (select count(*) from subcontractors where org_id = $1) as subcontractors,
       (select count(*) from communications where org_id = $1 and direction = 'outbound') as outreach_sent,
       (select count(*) from communications where org_id = $1 and direction = 'inbound') as replies_in,
       (select count(*) from documents where org_id = $1) as documents,
       (select sum(length(b.bytes)) from file_blobs b
          join documents d on d.storage_path = b.path
         where d.org_id = $1) as storage_bytes,
       (select max(created_at)::text from opportunities where org_id = $1) as last_record_at`,
    [orgId]
  ).catch(() => null);

  const n = (v: string | null | undefined): number | null => {
    if (v == null) return null;
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  };

  if (!row) {
    return {
      opportunities: null, pursued: null, bids: null, submitted: null,
      contracts: null, subcontractors: null, outreachSent: null, repliesIn: null,
      documents: null, storageBytes: null, lastRecordAt: null,
    };
  }

  return {
    opportunities: n(row.opportunities),
    pursued: n(row.pursued),
    bids: n(row.bids),
    submitted: n(row.submitted),
    contracts: n(row.contracts),
    subcontractors: n(row.subcontractors),
    outreachSent: n(row.outreach_sent),
    repliesIn: n(row.replies_in),
    documents: n(row.documents),
    storageBytes: n(row.storage_bytes),
    lastRecordAt: row.last_record_at ?? null,
  };
}

export interface AccountIntegration {
  id: string;
  label: string;
  verdict: IntegrationVerdict;
  lastSuccessAt: string | null;
  lastTestedAt: string | null;
  lastError: string | null;
  quotaNote: string | null;
}

/**
 * What this account's own integrations are doing.
 *
 * The same verdict the customer sees on their own Integrations page, from
 * the same function, so support and the customer are never looking at two
 * different answers to "is it working". Secrets are never read: only the
 * fact that a value exists, and what happened the last time it was used.
 */
export async function accountIntegrations(orgId: string): Promise<AccountIntegration[]> {
  const stored = await listSettings(orgId).catch(() => []);
  const byKey = new Map(stored.map((s) => [s.env_key, s]));

  // Customer-facing integrations only. The platform's own (Ahrefs, storage)
  // say nothing about this account and would only pad the list.
  return INTEGRATION_DEFS.filter((def) => !def.platformOnly).map((def) => {
    const keys = def.fields.map((f) => f.env);
    const rows = keys
      .map((k) => byKey.get(k))
      .filter((r): r is NonNullable<typeof r> => r != null);
    const configured =
      keys.length > 0 &&
      rows.length === keys.length &&
      rows.every((r) => (r.value ?? "").length > 0);
    const newest = (
      pick: (r: (typeof rows)[number]) => string | null
    ): string | null => {
      const values = rows.map(pick).filter((v): v is string => v != null);
      return values.length > 0 ? values[values.length - 1] : null;
    };
    const lastError = newest((r) => r.last_error);
    const lastTestedAt = newest((r) => r.last_tested_at ?? r.last_validated_at);
    const lastSuccessAt = newest((r) => r.last_success_at);
    return {
      id: def.id,
      label: def.name,
      verdict: integrationState({
        configured,
        lastError,
        lastValidatedAt: lastTestedAt,
        lastSuccessAt,
      }),
      lastSuccessAt,
      lastTestedAt,
      lastError,
      quotaNote: newest((r) => r.quota_note),
    };
  });
}

/** Every sign-in this account has had, newest first, for the support tab. */
export async function accountSessions(
  orgId: string,
  limit = 10
): Promise<{ email: string; created_at: string; expires_at: string | null }[]> {
  return query<{ email: string; created_at: string; expires_at: string | null }>(
    `select u.email, s.created_at::text as created_at, s.expires_at::text as expires_at
       from sessions s
       join users u on u.id = s.user_id
       join organization_members m on m.user_id = u.id and m.org_id = $1
      order by s.created_at desc
      limit $2`,
    [orgId, limit]
  ).catch(() => []);
}
