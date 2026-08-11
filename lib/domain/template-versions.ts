/**
 * Atomic template versioning.
 *
 * Uses a transaction-scoped PostgreSQL advisory lock keyed by the slug so
 * concurrent PATCH saves are fully serialised: the second caller blocks until
 * the first transaction commits, then observes the newly inserted version and
 * increments from there.  Row-level FOR UPDATE cannot provide this guarantee
 * because it only locks rows that already exist — two concurrent reads can
 * observe the same max(version) before either insert runs.
 */
import { transaction } from "../db";

export interface SavedTemplateVersion {
  id: string;
  version: number;
}

/**
 * Atomically save a new version of an outreach template.
 *
 * @param slug     One of the editable template slugs (validated by caller).
 * @param subject  New subject line, or null to keep the field empty.
 * @param body     New body content (caller must ensure non-empty).
 * @returns        The id and version of the newly created row.
 * @throws         If no rows exist for the slug (404-tagged error).
 */
export async function saveTemplateVersion(
  slug: string,
  subject: string | null,
  body: string
): Promise<SavedTemplateVersion> {
  return transaction(async (client) => {
    // Advisory lock serialises concurrent saves for this slug.
    // pg_advisory_xact_lock is transaction-scoped (auto-released on commit
    // or rollback) and blocks until it can acquire the lock — guaranteeing
    // that no two transactions ever read the same max version and attempt to
    // insert the same next version number.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [slug]);

    // Read existing rows — advisory lock already prevents concurrent writes.
    const existing = await client.query<{
      version: number;
      description: string | null;
    }>(`SELECT version, description FROM templates WHERE slug = $1`, [slug]);

    if (existing.rows.length === 0) {
      throw Object.assign(
        new Error(`Template slug not found in database: ${slug}`),
        { status: 404 }
      );
    }

    const maxVersion = existing.rows.reduce(
      (max, r) => Math.max(max, r.version),
      0
    );
    const nextVersion = maxVersion + 1;
    // Carry forward the description from whichever row has one.
    const description =
      existing.rows.find((r) => r.description != null)?.description ?? null;

    await client.query(
      `UPDATE templates SET is_active = false WHERE slug = $1`,
      [slug]
    );

    const ins = await client.query<{ id: string; version: number }>(
      `INSERT INTO templates (slug, version, is_active, subject, body, description)
       VALUES ($1, $2, true, $3, $4, $5)
       RETURNING id, version`,
      [slug, nextVersion, subject, body, description]
    );

    return ins.rows[0] ?? { id: "", version: nextVersion };
  });
}
