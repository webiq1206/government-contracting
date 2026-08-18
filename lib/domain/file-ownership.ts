/**
 * Which organization owns a stored file key.
 *
 * Storage keys are a single flat namespace shared by every tenant, and several
 * key shapes are guessable from an opportunity UUID alone (`bids/<oppId>/...`,
 * `capability-statements/<oppId>.pdf`). So the key itself is NOT a capability;
 * the only safe authorization is to resolve the key back to the record that
 * references it and check that record's org against the caller.
 *
 * Every key we write is referenced by exactly one of two tables, both carrying
 * org_id: `documents.storage_path` (solicitations, generated bids, capability
 * statements, operator uploads) and `subcontractor_documents.storage_path`
 * (W-9s and insurance certs). A key referenced by neither is unknown, and
 * unknown is refused, never served.
 */
import { queryOne } from "../db";

/**
 * The org that owns this storage key, or null when nothing references it.
 *
 * Read-only and side-effect free. Both lookups are exact-match on the stored
 * path, so a traversal or a guessed key that was never stored resolves to
 * null and the caller denies it.
 */
export async function orgIdForStorageKey(key: string): Promise<string | null> {
  if (!key) return null;
  const doc = await queryOne<{ org_id: string | null }>(
    `select org_id from documents where storage_path = $1 limit 1`,
    [key]
  ).catch(() => null);
  if (doc?.org_id) return doc.org_id;

  const subDoc = await queryOne<{ org_id: string | null }>(
    `select org_id from subcontractor_documents where storage_path = $1 limit 1`,
    [key]
  ).catch(() => null);
  return subDoc?.org_id ?? null;
}

/** True when this key is owned by exactly this org. Unknown keys are false. */
export async function orgOwnsStorageKey(key: string, orgId: string): Promise<boolean> {
  const owner = await orgIdForStorageKey(key);
  return owner != null && owner === orgId;
}
