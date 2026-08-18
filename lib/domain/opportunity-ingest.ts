/**
 * Idempotent opportunity ingest. Guarantees at most one open row per
 * (org, source_id) and per (org, solicitation_number). Concurrent monitor
 * runs hit the unique indexes and resolve to the existing id.
 */
import { query, queryOne } from "../db";
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
): Promise<void> {
  await query(
    `update opportunities set
        source_id = coalesce(source_id, $2),
        solicitation_number = coalesce(solicitation_number, $3),
        title = coalesce($4, title),
        description = coalesce($5, description),
        deadline = coalesce($6, deadline),
        posted_at = coalesce($7, posted_at),
        value_estimated = coalesce($8, value_estimated),
        value_estimated_source = coalesce($9, value_estimated_source),
        attachments_json = case
          when $10::jsonb is null then attachments_json
          when jsonb_typeof($10::jsonb) = 'array' and jsonb_array_length($10::jsonb) = 0 then attachments_json
          else $10::jsonb
        end,
        contact_json = coalesce($11::jsonb, contact_json),
        raw_json = coalesce($12::jsonb, raw_json),
        updated_at = now()
      where id = $1`,
    [
      id,
      sourceId,
      solicitationNumber,
      payload.title ?? null,
      payload.description ?? null,
      payload.deadline ?? null,
      payload.posted_at ?? null,
      payload.value_estimated ?? null,
      payload.value_estimated_source ?? null,
      payload.attachments_json != null
        ? JSON.stringify(payload.attachments_json)
        : null,
      payload.contact_json != null ? JSON.stringify(payload.contact_json) : null,
      payload.raw_json != null ? JSON.stringify(payload.raw_json) : null,
    ]
  );
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
    return { inserted: false, id: null, isSourcesSought };
  }

  const existing = await findExisting(
    payload.orgId,
    sourceId,
    solicitationNumber
  );
  if (existing) {
    await refreshExisting(
      existing.id,
      payload,
      sourceId,
      solicitationNumber
    ).catch((err) =>
      // A dropped refresh silently loses an AMENDED bid deadline: the record
      // keeps the old date and the operator plans around a deadline that has
      // moved. The ingest run continues; the failure does not.
      console.error(
        `[ingest] refresh of existing opportunity failed: ${(err as Error).message}`
      )
    );
    return {
      inserted: false,
      id: existing.id,
      dedupedBy: existing.reason,
      isSourcesSought,
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
    return { inserted: true, id: row!.id, isSourcesSought };
  } catch (err) {
    // Race: another worker inserted the same notice/sol # between SELECT and INSERT.
    if (!isUniqueViolation(err)) throw err;
    const raced = await findExisting(
      payload.orgId,
      sourceId,
      solicitationNumber
    );
    if (raced) {
      await refreshExisting(
        raced.id,
        payload,
        sourceId,
        solicitationNumber
      ).catch((err) =>
        console.error(
          `[ingest] refresh of raced opportunity failed: ${(err as Error).message}`
        )
      );
      return {
        inserted: false,
        id: raced.id,
        dedupedBy: raced.reason,
        isSourcesSought,
      };
    }
    throw err;
  }
}
