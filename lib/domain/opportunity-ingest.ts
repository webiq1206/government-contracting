/**
 * Idempotent opportunity ingest. Guarantees at most one open row per
 * (org, source_id) and per (org, solicitation_number). Concurrent monitor
 * runs hit the unique indexes and resolve to the existing id.
 */
import { query, queryOne } from "../db";
import { createHash } from "node:crypto";
import {
  attachmentIdentity,
  attachmentReferences,
  mergeAttachmentReferences,
} from "./attachment-identity";
import {
  normalizeSolicitationNumber,
  normalizeSourceId,
  preferDedupeMatch,
  type OpportunityDedupeReason,
} from "./opportunity-dedupe";

export interface OpportunityIngestPayload {
  orgId: string;
  source: string;
  source_id: string | null | undefined;
  solicitation_number?: string | null;
  title?: string | null;
  description?: string | null;
  naics_code?: string | null;
  psc_code?: string | null;
  set_aside_type?: string | null;
  value_estimated?: number | null;
  value_estimated_source?: string | null;
  deadline?: string | null;
  posted_at?: string | null;
  location_state?: string | null;
  location_text?: string | null;
  agency?: string | null;
  sub_agency?: string | null;
  contact_json?: unknown;
  attachments_json?: unknown;
  raw_json?: unknown;
  is_sources_sought?: boolean;
}

export interface OpportunityIngestResult {
  inserted: boolean;
  id: string | null;
  /** Why an insert was skipped (existing row). */
  dedupedBy?: OpportunityDedupeReason;
  isSourcesSought: boolean;
  /** An existing row was updated with newer source data. */
  refreshed: boolean;
  /** A field read by scoring or solicitation analysis changed. */
  materialChanged: boolean;
  /** Stable token for singleton downstream work after a refresh. */
  materialFingerprint?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

async function findExisting(
  orgId: string,
  sourceId: string | null,
  solicitationNumber: string | null
): Promise<{ id: string; reason: OpportunityDedupeReason } | null> {
  const bySourceId = sourceId
    ? await queryOne<{ id: string }>(
        `select id from opportunities where org_id = $1 and source_id = $2 limit 1`,
        [orgId, sourceId]
      )
    : null;

  const bySolicitationNumber =
    !bySourceId && solicitationNumber
      ? await queryOne<{ id: string }>(
          `select id from opportunities
            where org_id = $1
              and status = 'open'
              and solicitation_number is not null
              and lower(btrim(solicitation_number)) = lower(btrim($2))
            order by created_at asc
            limit 1`,
          [orgId, solicitationNumber]
        )
      : null;

  return preferDedupeMatch({ bySourceId, bySolicitationNumber });
}

/**
 * When a later notice (amendment / portal repost) matches an existing open
 * solicitation, refresh safe fields without restarting the pipeline.
 */
async function refreshExisting(
  id: string,
  payload: OpportunityIngestPayload,
  sourceId: string | null,
  solicitationNumber: string | null
): Promise<{ refreshed: boolean; materialChanged: boolean; materialFingerprint: string }> {
  const current = await queryOne<Record<string, unknown>>(
    `select source_id, solicitation_number, title, description, naics_code, psc_code,
            set_aside_type, value_estimated, value_estimated_source,
            deadline, posted_at, location_state, location_text, agency, sub_agency,
            contact_json, attachments_json, raw_json, risk_flags
       from opportunities where id = $1`,
    [id]
  );
  if (!current) throw new Error(`opportunity ${id} disappeared during refresh`);

  const incomingAttachments = attachmentReferences(payload.attachments_json);
  const attachments =
    incomingAttachments.length > 0
      ? mergeAttachmentReferences(current.attachments_json, incomingAttachments)
      : attachmentReferences(current.attachments_json);
  const next: Record<string, unknown> = {
    source_id: current.source_id ?? sourceId,
    solicitation_number: current.solicitation_number ?? solicitationNumber,
    title: payload.title ?? current.title,
    description: payload.description ?? current.description,
    naics_code: payload.naics_code ?? current.naics_code,
    psc_code: payload.psc_code ?? current.psc_code,
    set_aside_type: payload.set_aside_type ?? current.set_aside_type,
    value_estimated: payload.value_estimated ?? current.value_estimated,
    value_estimated_source: payload.value_estimated_source ?? current.value_estimated_source,
    deadline: payload.deadline ?? current.deadline,
    posted_at: payload.posted_at ?? current.posted_at,
    location_state: payload.location_state ?? current.location_state,
    location_text: payload.location_text ?? current.location_text,
    agency: payload.agency ?? current.agency,
    sub_agency: payload.sub_agency ?? current.sub_agency,
    contact_json: payload.contact_json ?? current.contact_json,
    attachments_json: attachments,
    raw_json: payload.raw_json ?? current.raw_json,
    risk_flags: current.risk_flags,
  };

  const beforeMaterial = materialFingerprint(current);
  const afterMaterial = materialFingerprint(next);
  const materialChanged = beforeMaterial !== afterMaterial;
  if (materialChanged) {
    const currentFlags = Array.isArray(current.risk_flags)
      ? current.risk_flags.filter((flag): flag is string => typeof flag === "string")
      : [];
    next.risk_flags = [...new Set([...currentFlags, "awaiting_document_analysis"])];
  }
  const refreshed = stableValue(current) !== stableValue(next);
  if (!refreshed) {
    return { refreshed: false, materialChanged: false, materialFingerprint: afterMaterial };
  }

  await query(
    `update opportunities set
        source_id=$2, solicitation_number=$3, title=$4, description=$5,
        naics_code=$6, psc_code=$7, set_aside_type=$8,
        value_estimated=$9, value_estimated_source=$10,
        deadline=$11, posted_at=$12, location_state=$13, location_text=$14,
        agency=$15, sub_agency=$16, contact_json=$17::jsonb,
        attachments_json=$18::jsonb, raw_json=$19::jsonb,
        risk_flags=$20::text[],
        analysis_input_hash=case when $21::boolean then null else analysis_input_hash end,
        updated_at = now()
      where id = $1`,
    [
      id,
      next.source_id,
      next.solicitation_number,
      next.title,
      next.description,
      next.naics_code,
      next.psc_code,
      next.set_aside_type,
      next.value_estimated,
      next.value_estimated_source,
      next.deadline,
      next.posted_at,
      next.location_state,
      next.location_text,
      next.agency,
      next.sub_agency,
      JSON.stringify(next.contact_json ?? null),
      JSON.stringify(next.attachments_json ?? []),
      JSON.stringify(next.raw_json ?? {}),
      next.risk_flags ?? [],
      materialChanged,
    ]
  );
  return { refreshed: true, materialChanged, materialFingerprint: afterMaterial };
}

function stableValue(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(row[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value.trim()) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.trim() : parsed.toISOString();
}

function materialFingerprint(row: Record<string, unknown>): string {
  const payload = {
    title: row.title ?? null,
    solicitation_number: row.solicitation_number ?? null,
    description: row.description ?? null,
    naics_code: row.naics_code ?? null,
    psc_code: row.psc_code ?? null,
    set_aside_type: row.set_aside_type ?? null,
    value_estimated: row.value_estimated ?? null,
    deadline: timestamp(row.deadline),
    posted_at: timestamp(row.posted_at),
    location_state: row.location_state ?? null,
    location_text: row.location_text ?? null,
    agency: row.agency ?? null,
    sub_agency: row.sub_agency ?? null,
    contact_json: row.contact_json ?? null,
    attachments: [
      ...new Set(
        attachmentReferences(row.attachments_json).map((ref) => attachmentIdentity(ref))
      ),
    ].sort(),
  };
  return createHash("sha256").update(stableValue(payload)).digest("hex");
}

/**
 * Insert a new opportunity or return the existing deduped row.
 * Requires a non-null source_id (external notice identity).
 */
export async function ingestOpportunity(
  payload: OpportunityIngestPayload
): Promise<OpportunityIngestResult> {
  const isSourcesSought = Boolean(payload.is_sources_sought);
  const sourceId = normalizeSourceId(payload.source_id);
  const solicitationNumber = normalizeSolicitationNumber(
    payload.solicitation_number
  );

  if (!sourceId) {
    return {
      inserted: false,
      id: null,
      isSourcesSought,
      refreshed: false,
      materialChanged: false,
    };
  }

  const existing = await findExisting(
    payload.orgId,
    sourceId,
    solicitationNumber
  );
  if (existing) {
    const refresh = await refreshExisting(
      existing.id,
      payload,
      sourceId,
      solicitationNumber
    );
    return {
      inserted: false,
      id: existing.id,
      dedupedBy: existing.reason,
      isSourcesSought,
      ...refresh,
    };
  }

  try {
    const row = await queryOne<{ id: string }>(
      `insert into opportunities
        (org_id, source, source_id, solicitation_number, title, description, naics_code, psc_code,
         set_aside_type, value_estimated, value_estimated_source, deadline, posted_at,
         location_state, location_text,
         agency, sub_agency, contact_json, attachments_json, raw_json, is_sources_sought,
         stage, status)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               'scoring','open')
       returning id`,
      [
        payload.orgId,
        payload.source,
        sourceId,
        solicitationNumber,
        payload.title ?? null,
        payload.description ?? null,
        payload.naics_code ?? null,
        payload.psc_code ?? null,
        payload.set_aside_type ?? null,
        payload.value_estimated ?? null,
        payload.value_estimated_source ?? null,
        payload.deadline ?? null,
        payload.posted_at ?? null,
        payload.location_state ?? null,
        payload.location_text ?? null,
        payload.agency ?? null,
        payload.sub_agency ?? null,
        payload.contact_json != null
          ? JSON.stringify(payload.contact_json)
          : null,
        payload.attachments_json != null
          ? JSON.stringify(payload.attachments_json)
          : JSON.stringify([]),
        payload.raw_json != null
          ? JSON.stringify(payload.raw_json)
          : JSON.stringify({}),
        isSourcesSought,
      ]
    );
    return {
      inserted: true,
      id: row!.id,
      isSourcesSought,
      refreshed: false,
      materialChanged: true,
    };
  } catch (err) {
    // Race: another worker inserted the same notice/sol # between SELECT and INSERT.
    if (!isUniqueViolation(err)) throw err;
    const raced = await findExisting(
      payload.orgId,
      sourceId,
      solicitationNumber
    );
    if (raced) {
      const refresh = await refreshExisting(
        raced.id,
        payload,
        sourceId,
        solicitationNumber
      );
      return {
        inserted: false,
        id: raced.id,
        dedupedBy: raced.reason,
        isSourcesSought,
        ...refresh,
      };
    }
    throw err;
  }
}
