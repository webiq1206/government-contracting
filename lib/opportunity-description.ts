/**
 * Make sure a SAM notice's description is the text and not the link to it.
 *
 * SAM's search results carry the URL of the description endpoint, and that
 * URL was stored as the description, so the scoring prompt read a link and
 * the record page printed one under "What this job is". This fetches the
 * text on first use and writes it back, once, so every later reader gets
 * words. One SAM call per notice, drawn from the same daily budget as the
 * monitor.
 */
import { query } from "./db";
import { sam } from "./integrations/sam";
import { isDescriptionPlaceholder } from "./domain/solicitation-import";

export async function ensureNoticeDescription(
  orgId: string,
  opp: { id: string; source: string; source_id: string | null; description: string | null }
): Promise<string | null> {
  if (!isDescriptionPlaceholder(opp.description)) return opp.description;
  if (opp.source !== "sam_federal" || !opp.source_id) return null;
  const res = await sam.noticeDescription(opp.source_id, orgId);
  if (!res.description) return null;
  // Only replace the placeholder; never overwrite text somebody has since
  // written or a later, fuller ingest.
  await query(
    `update opportunities set description=$2, updated_at=now()
      where id=$1 and org_id=$3 and (description is null or description ~* '^https?://')`,
    [opp.id, res.description, orgId]
  );
  return res.description;
}
