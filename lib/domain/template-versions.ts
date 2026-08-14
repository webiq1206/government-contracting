/**
 * Atomic template versioning, per organization.
 *
 * Uses a transaction-scoped PostgreSQL advisory lock keyed by (org, slug) so
 * concurrent PATCH saves are fully serialised: the second caller blocks until
 * the first transaction commits, then observes the newly inserted version and
 * increments from there.  Row-level FOR UPDATE cannot provide this guarantee
 * because it only locks rows that already exist — two concurrent reads can
 * observe the same max(version) before either insert runs.
 *
 * Copy-on-write: an org's first save creates its own v1 (seeded metadata from
 * the platform default) rather than mutating the shared default rows. From
 * then on the org versions independently. The old behaviour — deactivate the
 * rows for the slug, insert the next global version — was written for one
 * tenant, and with several it meant any customer's save rewrote the template
 * every other customer sends with.
 */
import { transaction } from "../db";
import { noEmDash } from "../sanitize";
import { LEGACY_ORG_ID } from "../tenant-context";

export interface SavedTemplateVersion {
  id: string;
  version: number;
}

/**
 * Atomically save a new version of an outreach template for one org.
 *
 * @param slug     One of the editable template slugs (validated by caller).
 * @param subject  New subject line, or null to keep the field empty.
 * @param body     New body content (caller must ensure non-empty).
 * @param orgId    The organization saving. Its rows are the only ones touched.
 * @returns        The id and version of the newly created row.
 * @throws         404-tagged error when the slug has no default to inherit,
 *                 which means the slug itself is wrong.
 */
export async function saveTemplateVersion(
  slug: string,
  rawSubject: string | null,
  rawBody: string,
  orgId: string
): Promise<SavedTemplateVersion> {
  // Outreach templates become emails to subcontractors, so the house rule
  // against em dashes has to hold here rather than at render time: the stored
  // text is what an operator reads back, edits, and previews, and a dash
  // stripped only on send would keep reappearing in the editor.
  const subject = rawSubject == null ? null : noEmDash(rawSubject);
  const body = noEmDash(rawBody);
  return transaction(async (client) => {
    // Lock key includes the org: two orgs saving the same slug do not contend,
    // two saves in one org fully serialise.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${orgId}:${slug}`]);

    const own = await client.query<{ version: number; description: string | null }>(
      `SELECT version, description FROM templates WHERE slug = $1 AND org_id = $2`,
      [slug, orgId]
    );

    let description: string | null =
      own.rows.find((r) => r.description != null)?.description ?? null;

    if (own.rows.length === 0) {
      // First save for this org: confirm the slug is real by finding the
      // platform default, and carry its description over.
      const dflt = await client.query<{ description: string | null }>(
        `SELECT description FROM templates WHERE slug = $1 AND org_id = $2 LIMIT 1`,
        [slug, LEGACY_ORG_ID]
      );
      if (dflt.rows.length === 0 && orgId !== LEGACY_ORG_ID) {
        throw Object.assign(
          new Error(`Template slug not found in database: ${slug}`),
          { status: 404 }
        );
      }
      description = dflt.rows[0]?.description ?? null;
    }

    const maxVersion = own.rows.reduce((max, r) => Math.max(max, r.version), 0);
    const nextVersion = maxVersion + 1;

    // Deactivate only this org's rows. The platform default stays active for
    // every org still inheriting it.
    await client.query(
      `UPDATE templates SET is_active = false WHERE slug = $1 AND org_id = $2`,
      [slug, orgId]
    );

    const ins = await client.query<{ id: string; version: number }>(
      `INSERT INTO templates (org_id, slug, version, is_active, subject, body, description)
       VALUES ($1, $2, $3, true, $4, $5, $6)
       RETURNING id, version`,
      [orgId, slug, nextVersion, subject, body, description]
    );

    return ins.rows[0] ?? { id: "", version: nextVersion };
  });
}
