/**
 * A save writes a draft; publishing is what starts sending it.
 *
 * These emails go to other people's businesses under the customer's name, so
 * the property being tested is narrow and load-bearing: nothing an operator
 * types can reach a subcontractor until somebody publishes it. Everything
 * else here defends that one line.
 *
 * Requires a real DATABASE_URL, skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { LEGACY_ORG_ID } from "../lib/tenant-context";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("template drafts and publishing (integration)", () => {
  let query: typeof import("../lib/db").query;
  let saveTemplateVersion: typeof import("../lib/domain/template-versions").saveTemplateVersion;
  let publishTemplateDraft: typeof import("../lib/domain/template-versions").publishTemplateDraft;
  let discardTemplateDraft: typeof import("../lib/domain/template-versions").discardTemplateDraft;
  let activeTemplate: typeof import("../lib/domain/template-store").activeTemplate;
  let templateDraft: typeof import("../lib/domain/template-store").templateDraft;

  const slug = `test_draft_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  // A second tenant, to prove one org cannot touch another's draft.
  const otherOrg = randomUUID();

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ saveTemplateVersion, publishTemplateDraft, discardTemplateDraft } = await import(
      "../lib/domain/template-versions"
    ));
    ({ activeTemplate, templateDraft } = await import("../lib/domain/template-store"));

    await query(
      `INSERT INTO organizations (id, name) VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [otherOrg, `Draft test tenant ${otherOrg.slice(0, 8)}`]
    );
    await query(
      `INSERT INTO templates (org_id, slug, version, is_active, subject, body)
       VALUES ($1, $2, 1, true, 'Approved subject', 'Approved body')`,
      [LEGACY_ORG_ID, slug]
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM templates WHERE slug = $1`, [slug]);
    await query(`DELETE FROM organizations WHERE id = $1`, [otherOrg]);
  });

  it("a save does not change what the send path reads", async () => {
    await saveTemplateVersion(slug, "Edited subject", "Edited body", LEGACY_ORG_ID, "nav@brostco.test");

    // activeTemplate() is the resolution the outreach agent itself uses. If a
    // draft could reach it, an unfinished edit would be in somebody's inbox.
    const live = await activeTemplate(slug, LEGACY_ORG_ID);
    expect(live?.body).toBe("Approved body");
    expect(live?.subject).toBe("Approved subject");

    const draft = await templateDraft(slug, LEGACY_ORG_ID);
    expect(draft?.body).toBe("Edited body");
    expect(draft?.draftedBy).toBe("nav@brostco.test");
  });

  it("a draft can never be the active row", async () => {
    const draft = await templateDraft(slug, LEGACY_ORG_ID);
    expect(draft).not.toBeNull();
    // Enforced by templates_draft_not_active_ck rather than by every writer
    // remembering, which is the only version of this that stays true.
    await expect(
      query(`UPDATE templates SET is_active = true WHERE id = $1`, [draft!.id])
    ).rejects.toThrow(/templates_draft_not_active_ck/);
  });

  it("only one draft can exist per template per organization", async () => {
    await expect(
      query(
        `INSERT INTO templates (org_id, slug, version, is_active, subject, body, status)
         VALUES ($1, $2, 99, false, 's', 'b', 'draft')`,
        [LEGACY_ORG_ID, slug]
      )
    ).rejects.toThrow(/templates_one_draft_uidx/);
  });

  it("publishing swaps exactly one active row and clears the draft", async () => {
    const published = await publishTemplateDraft(slug, LEGACY_ORG_ID, "dana@brostco.test");
    expect(published).not.toBeNull();

    const active = await query<{ version: number; body: string; status: string; published_by: string }>(
      `SELECT version, body, status, published_by FROM templates
        WHERE slug = $1 AND is_active = true`,
      [slug]
    );
    expect(active).toHaveLength(1);
    expect(active[0].body).toBe("Edited body");
    expect(active[0].status).toBe("published");
    expect(active[0].published_by).toBe("dana@brostco.test");

    // And the send path now agrees.
    const live = await activeTemplate(slug, LEGACY_ORG_ID);
    expect(live?.body).toBe("Edited body");
    expect(await templateDraft(slug, LEGACY_ORG_ID)).toBeNull();
  });

  it("publishing with nothing saved is refused rather than guessed at", async () => {
    expect(await publishTemplateDraft(slug, LEGACY_ORG_ID, "dana@brostco.test")).toBeNull();
  });

  it("discarding removes the draft and touches nothing that is being sent", async () => {
    await saveTemplateVersion(slug, "Abandoned", "Abandoned body", LEGACY_ORG_ID, "nav@brostco.test");
    expect(await discardTemplateDraft(slug, LEGACY_ORG_ID)).toBe(true);

    expect(await templateDraft(slug, LEGACY_ORG_ID)).toBeNull();
    const live = await activeTemplate(slug, LEGACY_ORG_ID);
    expect(live?.body).toBe("Edited body");
    // Nothing left to discard, reported as such rather than as success.
    expect(await discardTemplateDraft(slug, LEGACY_ORG_ID)).toBe(false);
  });

  it("one organization cannot publish or discard another's draft", async () => {
    await saveTemplateVersion(slug, "Ours", "Our body", LEGACY_ORG_ID, "nav@brostco.test");

    expect(await publishTemplateDraft(slug, otherOrg, "intruder@example.com")).toBeNull();
    expect(await discardTemplateDraft(slug, otherOrg)).toBe(false);

    // Still there, still unpublished, still ours.
    const draft = await templateDraft(slug, LEGACY_ORG_ID);
    expect(draft?.body).toBe("Our body");
    const live = await activeTemplate(slug, LEGACY_ORG_ID);
    expect(live?.body).toBe("Edited body");

    await discardTemplateDraft(slug, LEGACY_ORG_ID);
  });

  it("a second organization's save creates its own draft, not a change to ours", async () => {
    const saved = await saveTemplateVersion(slug, "Theirs", "Their body", otherOrg, "them@example.com");
    expect(saved.version).toBe(1);

    // Copy-on-write: the other org now has a draft of its own while still
    // inheriting the platform default for anything it sends today.
    const theirDraft = await templateDraft(slug, otherOrg);
    expect(theirDraft?.body).toBe("Their body");
    const theirLive = await activeTemplate(slug, otherOrg);
    expect(theirLive?.body).toBe("Edited body");
    expect(theirLive?.ownedByOrg).toBe(false);

    await publishTemplateDraft(slug, otherOrg, "them@example.com");
    const theirNewLive = await activeTemplate(slug, otherOrg);
    expect(theirNewLive?.body).toBe("Their body");
    expect(theirNewLive?.ownedByOrg).toBe(true);

    // And ours is exactly where it was.
    const ourLive = await activeTemplate(slug, LEGACY_ORG_ID);
    expect(ourLive?.body).toBe("Edited body");
  });
});
