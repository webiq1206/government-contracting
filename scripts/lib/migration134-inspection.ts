import { createHash } from "node:crypto";
import type { Client } from "pg";

export const MIGRATION134_SHA256 = "4a1fd239bd835c81900cae9f5e706736f5349bc973de9582602eae66674269e3";
const ORG = "00000000-0000-4000-8000-000000000001";
const RECEIPT_CUTOFF = "2026-10-14T04:28:32.846844Z";
const HOLD_CUTOFF = "2026-10-14T04:36:40.184866Z";
const MONTH_START = "2026-10-01T00:00:00.000000Z";
const TARGET = "134_gpt6_candidate_rates.sql";
const SERVICES = ["gpt-6-luna", "gpt-6-sol"];
const sha = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function validateInspectionScope(action: string, value?: string): "ledger" | "migration134" {
  const scope = value || "ledger";
  if (scope !== "ledger" && scope !== "migration134") throw new Error("Unknown release inspection scope.");
  if (scope === "migration134" && action !== "inspect") throw new Error("Migration134 evidence is read-only; use action=inspect.");
  return scope;
}

// PostgreSQL jsonb text canonicalizes object keys. UTC and explicit ordered row
// lists preserve microseconds/numeric text. Only count/SHA256 leave this module.
export function fingerprint(rows: readonly { row: string }[]) {
  return { count: rows.length, sha256: sha(JSON.stringify(rows.map(r => r.row))) };
}

export function assert134Ledger(pending: string[], mismatched: string[], checksums: (string | null)[]) {
  if (mismatched.length || checksums.some(checksum => !checksum) || pending.some(name => name !== TARGET)) {
    throw new Error("Migration134 inspection refused ledger drift, missing historical checksums or other pending migrations.");
  }
}

type Column = { table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null; numeric_precision?: number | null; numeric_scale?: number | null };
type Constraint = { table_name: string; kind: string; definition: string; deferred: boolean };
type Relation = { table_name: string; kind: string; rls: boolean; force_rls: boolean };
export function validateRateSchema(columns: Column[], constraints: Constraint[], relations: Relation[], triggers: unknown[], rules: unknown[]) {
  const expected: Record<string, string[]> = {
    api_usage_rates: ["provider:text:NO", "service:text:NO", "rates:jsonb:NO", "max_request_cost:numeric:YES", "evidence:text:NO", "updated_at:timestamp with time zone:NO"],
    _migrations: ["name:text:NO", "checksum:text:NO", "applied_at:timestamp with time zone:NO"],
  };
  for (const [table, contract] of Object.entries(expected)) {
    const actual = columns.filter(c => c.table_name === table).map(c => `${c.column_name}:${c.data_type}:${c.is_nullable}`);
    if (JSON.stringify(actual.sort()) !== JSON.stringify([...contract].sort())) throw new Error(`Unexpected ${table} column contract.`);
    const rel = relations.find(r => r.table_name === table);
    if (!rel || rel.kind !== "r" || rel.force_rls || (table === "api_usage_rates" && !rel.rls)) throw new Error(`Unexpected ${table} relation/RLS contract.`);
    const cs = constraints.filter(c => c.table_name === table);
    const pk = table === "api_usage_rates" ? "PRIMARY KEY (provider, service)" : "PRIMARY KEY (name)";
    if (!cs.some(c => c.kind === "p" && c.definition === pk && !c.deferred)
      || cs.some(c => c.deferred || !["p", "c"].includes(c.kind))
      || cs.length !== (table === "api_usage_rates" ? 2 : 1)
      || (table === "api_usage_rates" && !cs.some(c => c.kind === "c" && /^CHECK \(\(max_request_cost >= \(?0\)?(?:::numeric)?\)\)$/.test(c.definition)))) {
      throw new Error(`Unexpected ${table} constraint contract.`);
    }
    for (const c of columns.filter(c => c.table_name === table)) {
      const expectedDefault = ["updated_at", "applied_at"].includes(c.column_name) ? "now()" : null;
      if (c.column_default !== expectedDefault) throw new Error(`Unexpected ${table} column default.`);
      if (c.column_name === "max_request_cost" && (c.numeric_precision !== 24 || c.numeric_scale !== 12)) throw new Error("Unexpected rate numeric precision.");
    }
  }
  if (triggers.length || rules.length) throw new Error("Unexpected user trigger/rule on migration134 affected tables.");
}

export async function inspectMigration134(client: Pick<Client, "query">, migration: Buffer) {
  if (sha(migration) !== MIGRATION134_SHA256) throw new Error("Migration134 source hash differs from the approved SQL.");
  const state = (await client.query("select current_setting('transaction_read_only') as readonly, current_setting('transaction_isolation') as isolation, current_setting('TimeZone') as timezone, clock_timestamp()::text as observed_at")).rows[0];
  if (state.readonly !== "on" || state.isolation !== "repeatable read" || state.timezone !== "UTC") throw new Error("Inspection requires a UTC repeatable-read READ ONLY snapshot.");
  const tables = ["api_usage_rates", "_migrations"];
  const columns = (await client.query<Column>(`select table_name,column_name,data_type,is_nullable,column_default,numeric_precision,numeric_scale from information_schema.columns where table_schema='public' and table_name=any($1::text[]) order by table_name,ordinal_position`, [tables])).rows;
  const constraints = (await client.query<Constraint>(`select c.relname as table_name,k.contype as kind,pg_get_constraintdef(k.oid) as definition,k.condeferrable as deferred from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname,k.conname`, [tables])).rows;
  const relations = (await client.query<Relation>(`select c.relname as table_name,c.relkind as kind,c.relrowsecurity as rls,c.relforcerowsecurity as force_rls from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) order by c.relname`, [tables])).rows;
  const triggers = (await client.query(`select c.relname,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=any($1::text[]) and not t.tgisinternal`, [tables])).rows;
  const rules = (await client.query(`select tablename,rulename from pg_rules where schemaname='public' and tablename=any($1::text[])`, [tables])).rows;
  validateRateSchema(columns, constraints, relations, triggers, rules);
  const digest = async (sql: string, values: unknown[] = []) => fingerprint((await client.query<{ row: string }>(sql, values)).rows);
  const ledger = await digest(`select to_jsonb(t)::text as row from (select name,checksum,applied_at::text from _migrations where name<>$1 order by name) t`, [TARGET]);
  const applied = (await client.query(`select checksum from _migrations where name=$1`, [TARGET])).rows;
  if (applied.length && applied[0].checksum !== MIGRATION134_SHA256) throw new Error("Migration134 applied checksum differs.");
  const candidateRates = [];
  for (const service of SERVICES) {
    const rows = (await client.query<{ row: string }>(`select to_jsonb(t)::text as row from (select provider,service,rates,max_request_cost::text,evidence,updated_at::text from api_usage_rates where provider='OpenAI' and service=$1) t`, [service])).rows;
    const expectedRates = service === "gpt-6-luna"
      ? { input_tokens: "0.10", output_tokens: "0.50", cached_input_tokens: "0.01", cache_write_input_tokens: "0.125" }
      : { input_tokens: "2", output_tokens: "10", cached_input_tokens: "0.20", cache_write_input_tokens: "2.50" };
    const row = rows[0] ? JSON.parse(rows[0].row) : null;
    const matchesReviewedInsert = row !== null && Number(row.max_request_cost) === 3
      && Object.keys(row.rates).length === 4 && Object.entries(expectedRates).every(([k,v]) => row.rates[k] === v)
      && row.evidence === `https://developers.openai.com/api/docs/models/${service} (2026-10-14); standard-context candidate, rollout not approved`;
    candidateRates.push({ service, ...fingerprint(rows), matchesReviewedInsert });
  }
  const otherRates = await digest(`select to_jsonb(t)::text as row from (select provider,service,rates,max_request_cost::text,evidence,updated_at::text from api_usage_rates where not(provider='OpenAI' and service=any($1::text[])) order by provider,service) t`, [SERVICES]);
  const receipts = await digest(`select to_jsonb(t)::text as row from (select org_id,work_key,scope_key,input_hash,owner,state,started_at::text,completed_at::text from ai_work_receipts where org_id=$1 and state in ('pending','complete') and started_at<=$2::timestamptz order by work_key) t`, [ORG,RECEIPT_CUTOFF]);
  const holdQuery = `select to_jsonb(t)::text as row from (select id,org_id,provider,service,feature,workflow,credential_source,billing_status,batch_id,reserved_cost::text,outcome,started_at::text,finished_at::text from api_usage_events where org_id=$1 and provider_cost is null and budget_cost is null and reserved_cost>0 and started_at<=$2::timestamptz and ($3::timestamptz is null or started_at >= $3::timestamptz) order by id) t`;
  const holds = await digest(holdQuery,[ORG,HOLD_CUTOFF,null]);
  const monthHolds = await digest(holdQuery,[ORG,HOLD_CUTOFF,MONTH_START]);
  const budgets = await digest(`select to_jsonb(t)::text as row from (select org_id,daily_limit::text,monthly_limit::text,daily_requests,paused,allow_complex,updated_at::text from api_account_budgets where org_id=$1 order by org_id) t`,[ORG]);
  const automation = await digest(`select to_jsonb(t)::text as row from (select key,value_json->'paused' as paused,updated_at::text from app_settings where key in ('automation','platform_automation') order by key) t`);
  const limits = await digest(`select to_jsonb(t)::text as row from (select id,org_id,provider,feature,monthly_limit::text,warning_percent,paused,require_tenant_key,updated_at::text,daily_requests from api_usage_limits where org_id=$1 or org_id is null order by id) t`,[ORG]);
  // Never select credential_hash, credential_fingerprint, settings or secrets.
  const providerFacts = await digest(`select to_jsonb(t)::text as row from (select account_scope,provider,last_success_at::text,last_failure_at::text,failure_reason,failure_status,refusal_reason,refusal_status,pending_attempt,pending_started_at::text from ai_provider_facts where account_scope='platform') t order by to_jsonb(t)::text`);
  return { method: "migration134-pg-jsonb-text-utc-v1", observedAt: state.observed_at,
    readOnly: true, rawRowsExported: false, migrationSha256: MIGRATION134_SHA256,
    migrationApplied: applied.length === 1, schema: { columns, constraints, relations, triggers, rules },
    candidateRates, preservation: { ledger, otherRates, receipts, holds, monthHolds, budgets, automation, limits, providerFacts },
    cohort: { org: ORG, receiptCutoff: RECEIPT_CUTOFF, holdCutoff: HOLD_CUTOFF, monthStart: MONTH_START } };
}
