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
import { query, transaction } from "../db";
import { noEmDash } from "../sanitize";
import { LEGACY_ORG_ID } from "../tenant-context";

export interface SavedTemplateVersion {
  id: string;
  version: number;
  /** When the draft was written, from the database clock rather than the
   *  browser's, so the editor and the history agree about when. */
  draftedAt: string;
}

/**
 * Put a saved draft into use.
 *
 * The moment the platform starts sending the new wording. Separate from the
 * save on purpose, and it is the only path that sets is_active, so an
 * unpublished edit cannot reach a subcontractor by any other route.
 */
export async function publishTemplateDraft(
  slug: string,
  orgId: string,
  publishedBy: string
): Promise<{ version: number } | null> {
  return transaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${orgId}:${slug}`]);

    const draft = await client.query<{ id: string; version: number }>(
      `SELECT id, version FROM templates
        WHERE slug = $1 AND org_id = $2 AND status = 'draft'
        ORDER BY version DESC LIMIT 1`,
      [slug, orgId]
    );
    if (draft.rows.length === 0) return null;

    // Only this org's rows. The platform default stays active for every org
    // still inheriting it.
    await client.query(
      `UPDATE templates SET is_active = false WHERE slug = $1 AND org_id = $2`,
      [slug, orgId]
    );
    await client.query(
      `UPDATE templates
          SET is_active = true, status = 'published',
              published_at = now(), published_by = $3
        WHERE id = $1 AND org_id = $2`,
      [draft.rows[0].id, orgId, publishedBy]
    );
    return { version: draft.rows[0].version };
  });
}

/**
 * Throw away an unpublished draft.
 *
 * The way back from an edit somebody started and thought better of. Nothing
 * in use is touched, because a draft is never the active row.
 */
export async function discardTemplateDraft(
  slug: string,
  orgId: string
): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `DELETE FROM templates
      WHERE slug = $1 AND org_id = $2 AND status = 'draft'
      RETURNING id`,
    [slug, orgId]
  );
  return rows.length > 0;
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
  orgId: string,
  savedBy: string
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

    /*
     * A save writes a draft. It does not touch the active row.
     *
     * These templates become emails to other people's businesses under this
     * company's name, and saving used to put a half-finished edit in front of
     * the next outreach run. Publishing is a separate act now, and the active
     * row keeps sending what was approved until somebody approves the new one.
     */
    await client.query(
      `DELETE FROM templates WHERE slug = $1 AND org_id = $2 AND status = 'draft'`,
      [slug, orgId]
    );

    const ins = await client.query<{ id: string; version: number; draftedAt: string }>(
      `INSERT INTO templates
         (org_id, slug, version, is_active, subject, body, description,
          status, drafted_at, drafted_by)
       VALUES ($1, $2, $3, false, $4, $5, $6, 'draft', now(), $7)
       RETURNING id, version, drafted_at::text as "draftedAt"`,
      [orgId, slug, nextVersion, subject, body, description, savedBy]
    );

    return ins.rows[0] ?? { id: "", version: nextVersion, draftedAt: new Date().toISOString() };
  });
}
