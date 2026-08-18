/**
 * The records a job payload names, and who owns them.
 *
 * Two callers need this and must agree. The runner needs it to decide which
 * tenant a job runs as, and to notice that the record a job was about has been
 * deleted. The manual-run endpoint needs it to refuse a record the caller does
 * not own, because that endpoint takes record ids from a request body and the
 * runner would otherwise resolve the tenant from someone else's record and run
 * the agent as them.
 *
 * Each entry is a full statement rather than a table name spliced into one, so
 * this list cannot become a place where a string reaches SQL. To support a new
 * payload key, add its lookup here and both callers pick it up.
 */
import { queryOne } from "../db";

/** Postgres: the text given for a uuid column is not a uuid. */
const INVALID_TEXT_REPRESENTATION = "22P02";

export const ORG_OF_PAYLOAD: { key: string; label: string; sql: string }[] = [
  // Order is priority. The opportunity is what the work is about, so when a
  // payload names several records it decides.
  {
    key: "opportunityId",
    label: "opportunity",
    sql: `select org_id from opportunities where id = $1`,
  },
  {
    key: "subcontractorId",
    label: "subcontractor",
    sql: `select org_id from subcontractors where id = $1`,
  },
];

/**
 * `found` is the only state with an owner. `deleted` and `malformed` are both
 * permanent: neither will resolve on a later attempt. `unknown` means the
 * database could not answer, which is the one case where trying again later is
 * the right response.
 */
export type PayloadRecordState = "found" | "deleted" | "malformed" | "unknown";

export interface PayloadRecord {
  key: string;
  label: string;
  id: string;
  state: PayloadRecordState;
  /** The owning organization, only ever set when the record was found. */
  orgId: string | null;
}

/** Look up every record a payload names. Keys it does not name are skipped. */
export async function lookupPayloadRecords(
  payload: Record<string, unknown>
): Promise<PayloadRecord[]> {
  const found: PayloadRecord[] = [];

  for (const { key, label, sql } of ORG_OF_PAYLOAD) {
    const id = payload[key];
    if (typeof id !== "string" || !id) continue;

    try {
      const row = await queryOne<{ org_id: string | null }>(sql, [id]);
      found.push(
        row
          ? { key, label, id, state: "found", orgId: row.org_id }
          : { key, label, id, state: "deleted", orgId: null }
      );
    } catch (err) {
      const malformed = (err as { code?: string }).code === INVALID_TEXT_REPRESENTATION;
      found.push({ key, label, id, state: malformed ? "malformed" : "unknown", orgId: null });
    }
  }

  return found;
}

/** A record that cannot be worked on, because it is gone or was never real. */
export function isPermanentlyGone(record: PayloadRecord): boolean {
  return record.state === "deleted" || record.state === "malformed";
}
