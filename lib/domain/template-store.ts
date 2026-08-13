/**
 * Org-aware template resolution: your copy if you have one, the platform
 * default if you do not.
 *
 * The founding org's template rows double as the platform defaults. Every
 * migration that seeded or reworded a template (024, 027, 030, 032) wrote
 * rows that 028 later assigned to the founding org, so "the default" and
 * "the founding org's copy" are physically the same rows. A new organization
 * therefore starts with working outreach templates it does not own, and the
 * first time it saves an edit it gets its own copy (copy-on-write, handled by
 * saveTemplateVersion). Nothing an org saves ever mutates the shared default,
 * which is the property that was missing: before this, one customer editing
 * "their" outreach template reworded the emails every other customer sends.
 */
import { query } from "../db";
import { LEGACY_ORG_ID } from "../tenant-context";

export interface ActiveTemplate {
  id: string;
  slug: string;
  version: number;
  subject: string | null;
  body: string;
  description: string | null;
  /** False when the org is still on the platform default. */
  ownedByOrg: boolean;
}

/** The template an org actually sends with: own copy first, else default. */
export async function activeTemplate(
  slug: string,
  orgId: string | null
): Promise<ActiveTemplate | null> {
  const rows = await query<ActiveTemplate & { org_id: string | null }>(
    `select id, slug, version, subject, body, description, org_id,
            (org_id = $2) as "ownedByOrg"
       from templates
      where slug = $1 and is_active = true and org_id in ($2, $3)
      order by (org_id = $2) desc, version desc
      limit 1`,
    [slug, orgId ?? LEGACY_ORG_ID, LEGACY_ORG_ID]
  );
  return rows[0] ?? null;
}

/** Active version of each slug, own copies winning over defaults. */
export async function activeTemplates(
  slugs: readonly string[],
  orgId: string | null
): Promise<ActiveTemplate[]> {
  return query<ActiveTemplate>(
    `select distinct on (slug)
            id, slug, version, subject, body, description,
            (org_id = $2) as "ownedByOrg"
       from templates
      where slug = any($1) and is_active = true and org_id in ($2, $3)
      order by slug, (org_id = $2) desc, version desc`,
    [slugs, orgId ?? LEGACY_ORG_ID, LEGACY_ORG_ID]
  );
}

/**
 * Version history for the editor: the org's own saves once any exist,
 * otherwise the default lineage it is inheriting. Not interleaved, because a
 * history that mixes rows the org can restore with rows it cannot would turn
 * the restore button into a lottery.
 */
export async function templateHistory(
  slug: string,
  orgId: string | null,
  limit = 5
): Promise<
  { id: string; version: number; subject: string | null; body: string; is_active: boolean; created_at: string }[]
> {
  const own = await query<{
    id: string; version: number; subject: string | null; body: string; is_active: boolean; created_at: string;
  }>(
    `select id, version, subject, body, is_active, created_at::text as created_at
       from templates where slug = $1 and org_id = $2
      order by version desc limit $3`,
    [slug, orgId ?? LEGACY_ORG_ID, limit]
  );
  if (own.length > 0 || orgId === LEGACY_ORG_ID || orgId == null) return own;
  return query(
    `select id, version, subject, body, is_active, created_at::text as created_at
       from templates where slug = $1 and org_id = $2
      order by version desc limit $3`,
    [slug, LEGACY_ORG_ID, limit]
  );
}
