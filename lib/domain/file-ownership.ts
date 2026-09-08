/**
 * Which organization owns a stored file key.
 *
 * Storage keys are a single flat namespace shared by every tenant, and several
 * key shapes are guessable from an opportunity UUID alone (`bids/<oppId>/...`,
 * `capability-statements/<oppId>.pdf`). So the key itself is NOT a capability;
 * the only safe authorization is to resolve the key back to the record that
 * references it and check that record's org against the caller.
 *
 * Every key we write is referenced by exactly one of four tables, all carrying
 * org_id: `documents.storage_path` (solicitations, generated bids, capability
 * statements, operator uploads), `subcontractor_documents.storage_path`
 * (W-9s and insurance certs), `compliance_item_documents.storage_path`
 * (the company's own registrations, certifications and policies), and
 * `feedback_reports.storage_path` (a screenshot somebody attached to a
 * report). A key referenced by none of them is unknown, and unknown is
 * refused, never served.
 *
 * A table that stores keys and is not listed here does not fail loudly: its
 * files are simply never served, to anybody. tests/file-ownership-tables keeps
 * the list honest against the schema.
 */
import { queryOne } from "../db";

/**
 * The org that owns this storage key, or null when nothing references it.
 *
 * Read-only and side-effect free. Every lookup is exact-match on the stored
 * path, so a traversal or a guessed key that was never stored resolves to
 * null and the caller denies it.
 */
export async function orgIdForStorageKey(
  key: string,
  opts?: { failOnError?: boolean }
): Promise<string | null> {
  if (!key) return null;
  const lookup = <T extends { org_id: string | null }>(sql: string): Promise<T | null> => {
    const result = queryOne<T>(sql, [key]);
    return opts?.failOnError ? result : result.catch(() => null);
  };
  const doc = await lookup<{ org_id: string | null }>(
    `select coalesce(d.org_id, o.org_id) as org_id
       from documents d
       left join opportunities o on o.id = d.opportunity_id
      where d.storage_path = $1 limit 1`
  );
  if (doc?.org_id) return doc.org_id;

  const subDoc = await lookup<{ org_id: string | null }>(
    `select coalesce(d.org_id, s.org_id) as org_id
       from subcontractor_documents d
       left join subcontractors s on s.id = d.subcontractor_id
      where d.storage_path = $1 limit 1`
  );
  if (subDoc?.org_id) return subDoc.org_id;

  const complianceDoc = await lookup<{ org_id: string | null }>(
    `select org_id from compliance_item_documents where storage_path = $1 limit 1`
  );
  if (complianceDoc?.org_id) return complianceDoc.org_id;

  const feedbackShot = await lookup<{ org_id: string | null }>(
    `select org_id from feedback_reports where storage_path = $1 limit 1`
  );
  return feedbackShot?.org_id ?? null;
}

/** True when this key is owned by exactly this org. Unknown keys are false. */
export async function orgOwnsStorageKey(key: string, orgId: string): Promise<boolean> {
  const owner = await orgIdForStorageKey(key);
  return owner != null && owner === orgId;
}
