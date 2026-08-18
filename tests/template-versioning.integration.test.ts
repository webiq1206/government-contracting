/**
 * Integration tests for saveTemplateVersion() (lib/domain/template-versions).
 *
 * Requires a real DATABASE_URL — skipped otherwise so the suite still passes
 * in CI or offline environments. Each test creates its own fixture slug and
 * cleans up in afterAll, so tests are safe to run against the dev database.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { LEGACY_ORG_ID } from "../lib/tenant-context";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("saveTemplateVersion — concurrent saves (integration)", () => {
  let query: typeof import("../lib/db").query;
  let saveTemplateVersion: typeof import("../lib/domain/template-versions").saveTemplateVersion;

  // Use a slug that isn't a real editable slug so we don't corrupt live templates.
  // The function under test doesn't validate slug names — the API route does that.
  const testSlug = `test_template_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ saveTemplateVersion } = await import("../lib/domain/template-versions"));

    // Seed one initial version so the slug exists. Templates are org-owned
    // now; the founding org's row doubles as the platform default.
    await query(
      `INSERT INTO templates (org_id, slug, version, is_active, subject, body)
       VALUES ($1, $2, 1, true, 'Initial subject', 'Initial body')`,
      [LEGACY_ORG_ID, testSlug]
    );
  });

  afterAll(async () => {
    // Remove all rows created for this test slug.
    await query(`DELETE FROM templates WHERE slug = $1`, [testSlug]);
  });

  it("sequential saves produce strictly increasing versions", async () => {
    const v2 = await saveTemplateVersion(testSlug, "Subject v2", "Body v2", LEGACY_ORG_ID);
    const v3 = await saveTemplateVersion(testSlug, "Subject v3", "Body v3", LEGACY_ORG_ID);

    expect(v2.version).toBe(2);
    expect(v3.version).toBe(3);
  });

  it("after each save exactly one row is active", async () => {
    await saveTemplateVersion(testSlug, "Subject v4", "Body v4", LEGACY_ORG_ID);

    const active = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM templates WHERE slug = $1 AND is_active = true`,
      [testSlug]
    );
    expect(Number(active[0]?.count)).toBe(1);
  });

  it("concurrent saves all succeed with unique, sequential versions", async () => {
    // Fire N saves concurrently. The advisory lock in saveTemplateVersion must
    // serialise them so all succeed and no two rows share a version number.
    const CONCURRENT = 5;
    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, (_, i) =>
        saveTemplateVersion(testSlug, `Concurrent subject ${i}`, `Concurrent body ${i}`, LEGACY_ORG_ID)
      )
    );

    // All saves returned successfully.
    expect(results).toHaveLength(CONCURRENT);
    results.forEach((r) => {
      expect(typeof r.version).toBe("number");
      expect(r.version).toBeGreaterThan(0);
    });

    // All returned version numbers are unique.
    const versions = results.map((r) => r.version);
    expect(new Set(versions).size).toBe(CONCURRENT);

    // Database also has exactly one active row.
    const active = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM templates WHERE slug = $1 AND is_active = true`,
      [testSlug]
    );
    expect(Number(active[0]?.count)).toBe(1);

    // Total row count reflects the seed + sequential + after-each + concurrent saves.
    const total = await query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM templates WHERE slug = $1`,
      [testSlug]
    );
    // 1 (seed) + 2 (sequential) + 1 (after-each) + 5 (concurrent) = 9
    expect(Number(total[0]?.count)).toBe(9);
  });

  it("throws a 404-tagged error when slug does not exist", async () => {
    // A non-founding org saving an unknown slug is refused; the founding org
    // is allowed to create, so the 404 contract lives on the tenant path.
    const missingSlug = `no_such_slug_${randomUUID().slice(0, 8)}`;
    await expect(
      saveTemplateVersion(missingSlug, null, "body", randomUUID())
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});
