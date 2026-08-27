/**
 * A feedback report belongs to one account, and its screenshot is a tenant
 * file like any other.
 *
 * The consent promise is the load-bearing part: unticking the box has to mean
 * nothing extra is kept, and a promise that depends on every future code path
 * remembering is not one. A check constraint enforces it instead.
 *
 * Requires a real DATABASE_URL, skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("feedback reports (integration)", () => {
  let query: typeof import("../lib/db").query;
  let submitFeedback: typeof import("../lib/feedback").submitFeedback;
  let feedbackFor: typeof import("../lib/feedback").feedbackFor;
  let orgIdForStorageKey: typeof import("../lib/domain/file-ownership").orgIdForStorageKey;

  const orgA = randomUUID();
  const orgB = randomUUID();

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ submitFeedback, feedbackFor } = await import("../lib/feedback"));
    ({ orgIdForStorageKey } = await import("../lib/domain/file-ownership"));
    for (const id of [orgA, orgB]) {
      await query(
        `insert into organizations (id, name) values ($1, $2) on conflict (id) do nothing`,
        [id, `Feedback test ${id.slice(0, 8)}`]
      );
    }
  });

  afterAll(async () => {
    const paths = await query<{ storage_path: string }>(
      `select storage_path from feedback_reports
        where org_id = any($1::uuid[]) and storage_path is not null`,
      [[orgA, orgB]]
    );
    await query(`delete from feedback_reports where org_id = any($1::uuid[])`, [[orgA, orgB]]);
    for (const p of paths) {
      await query(`delete from file_blobs where path = $1`, [p.storage_path]).catch(() => {});
    }
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]);
  });

  it("files a report against the sender's own organization", async () => {
    const r = await submitFeedback({
      orgId: orgA,
      userId: null,
      userEmail: "nav@brostco.test",
      category: "wrong_number",
      message: "Today says 4 active opportunities and the list underneath shows 3.",
      page: "/today?filter=urgent&q=roof",
      userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
    });
    expect(r.ok).toBe(true);

    const [row] = await feedbackFor(orgA);
    expect(row.category).toBe("wrong_number");
    // The path survived and the query string did not.
    expect(row.page).toBe("/today");
    expect(row.browser).toContain("Mozilla");
    expect(row.diagnostics).toBeNull();
    expect(row.diagnostics_consented).toBe(false);
  });

  it("keeps no diagnostics when the sender did not consent", async () => {
    await submitFeedback({
      orgId: orgA,
      userId: null,
      userEmail: "nav@brostco.test",
      category: "confusing",
      message: "The publish button did not say what it would change.",
      diagnostics: { viewportWidth: 1440, cookie: "brostco_session=abc" },
      diagnosticsConsented: false,
    });
    const [row] = await feedbackFor(orgA);
    expect(row.diagnostics).toBeNull();
  });

  it("keeps only the allow-listed fields when the sender did consent", async () => {
    await submitFeedback({
      orgId: orgA,
      userId: null,
      userEmail: "nav@brostco.test",
      category: "bug",
      message: "Saving the outreach template threw an error the first time.",
      diagnostics: {
        viewportWidth: 1440,
        timezone: "America/Boise",
        cookie: "brostco_session=abc",
        apiKey: "sk-live-should-never-be-stored",
      },
      diagnosticsConsented: true,
    });
    const [row] = await feedbackFor(orgA);
    expect(row.diagnostics).toEqual({ viewportWidth: 1440, timezone: "America/Boise" });
    expect(JSON.stringify(row.diagnostics)).not.toContain("sk-live");
    expect(JSON.stringify(row.diagnostics)).not.toContain("brostco_session");
  });

  it("cannot store diagnostics without consent, even by mistake", async () => {
    // The constraint rather than the code path: the promise beside the
    // checkbox has to hold for a writer nobody has written yet.
    await expect(
      query(
        `insert into feedback_reports (org_id, category, message, diagnostics, diagnostics_consented)
         values ($1, 'bug', 'x', '{"viewportWidth":10}'::jsonb, false)`,
        [orgA]
      )
    ).rejects.toThrow(/feedback_reports_consent_ck/);
  });

  it("refuses a category it does not define and a message too short to act on", async () => {
    expect(
      await submitFeedback({
        orgId: orgA, userId: null, userEmail: null,
        category: "rant", message: "The whole thing is broken and I am cross.",
      })
    ).toEqual({ ok: false, error: "Pick what kind of problem this is." });

    const short = await submitFeedback({
      orgId: orgA, userId: null, userEmail: null, category: "bug", message: "broken",
    });
    expect(short.ok).toBe(false);
  });

  it("resolves an attached screenshot back to the org that sent it", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489",
      "hex"
    );
    const file = new File([png], "screen shot.png", { type: "image/png" });
    const r = await submitFeedback({
      orgId: orgB,
      userId: null,
      userEmail: "them@example.com",
      category: "bug",
      message: "The board card overlapped the column header at this width.",
      screenshot: file,
    });
    expect(r.ok).toBe(true);

    const [row] = await feedbackFor(orgB);
    expect(row.storage_path).toBeTruthy();
    expect(row.screenshot_name).toBe("screen shot.png");
    // The resolver is what stands between a flat storage namespace and one
    // tenant reading another's files. A table it does not know about has its
    // files refused to everybody, which nobody reports as a resolver bug.
    expect(await orgIdForStorageKey(row.storage_path!)).toBe(orgB);
  });

  it("keeps one organization's reports out of another's", async () => {
    const a = await feedbackFor(orgA);
    const b = await feedbackFor(orgB);
    expect(a.length).toBeGreaterThan(1);
    expect(b).toHaveLength(1);
    expect(b[0].user_email).toBe("them@example.com");
    expect(a.every((r) => r.user_email !== "them@example.com")).toBe(true);
  });
});
