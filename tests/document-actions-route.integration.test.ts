/**
 * The three judgements a person can record about a document.
 *
 *   review    somebody read the file and said what is true about it
 *   exclude   this document is irrelevant to the bid, and here is why
 *   supersede this file was replaced by another one
 *
 * Each of them changes whether the brief can be trusted, so each takes the
 * same capability as deciding to pursue the opportunity at all, and each has
 * to say something. A review with no note clears a blocker and records
 * nothing, which is worth less than the blocker it cleared. An exclusion with
 * no reason cannot be told apart from a file that was quietly lost.
 *
 * Run against a real database: the exclusion rule is a check constraint as
 * well as a validation, and only one of those can be proved with a mock.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../lib/auth";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../lib/auth")>()),
  currentUser: async () => CURRENT,
}));

d("recording a judgement about a document", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let PATCH: typeof import("../app/api/documents/[id]/route").PATCH;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const opp = randomUUID();
  const otherOpp = randomUUID();
  const docA = randomUUID();
  const docB = randomUUID();
  const docElsewhere = randomUUID();

  const call = (id: string, body: unknown) =>
    PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), {
      params: { id },
    });

  const signIn = (orgId: string, orgRole: string) => {
    CURRENT = {
      id: randomUUID(), email: "op@probe.invalid", name: "Op", role: "member",
      orgRole, organizationId: orgId, subscriptionStatus: "active",
      planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ PATCH } = await import("../app/api/documents/[id]/route"));
    for (const [id, name] of [[org, "Docs A"], [otherOrg, "Docs B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    for (const [id, o] of [[opp, org], [otherOpp, otherOrg]] as const) {
      await query(
        `insert into opportunities (id, org_id, title, source, stage)
         values ($1,$2,'Doc actions probe','test','analysis') on conflict (id) do nothing`,
        [id, o]
      );
    }
    await query(
      `insert into documents (id, org_id, opportunity_id, kind, name, disposition, extraction_state)
       values ($1,$2,$3,'solicitation','PWS.pdf','delivered','extracted'),
              ($4,$2,$3,'solicitation','Amendment 0002.pdf','delivered','extracted'),
              ($5,$6,$7,'solicitation','Their PWS.pdf','delivered','extracted')`,
      [docA, org, opp, docB, docElsewhere, otherOrg, otherOpp]
    );
    signIn(org, "owner");
  });

  afterEach(async () => {
    await query(
      `update documents set disposition='delivered', excluded_reason=null, excluded_by=null,
              excluded_at=null, reviewed_by=null, reviewed_at=null, review_note=null,
              superseded_by=null
        where id = any($1::uuid[])`,
      [[docA, docB]]
    );
  });

  afterAll(async () => {
    await query(`delete from agent_logs where opportunity_id = any($1::uuid[])`, [[opp, otherOpp]]).catch(() => {});
    await query(`delete from documents where id = any($1::uuid[])`, [[docA, docB, docElsewhere]]).catch(() => {});
    await query(`delete from opportunities where id = any($1::uuid[])`, [[opp, otherOpp]]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("records a review with what the reader found", async () => {
    const res = await call(docA, { action: "review", note: "Requires a 20-page technical volume." });
    expect(res.status).toBe(200);
    const row = await queryOne<{ reviewed_by: string; review_note: string }>(
      `select reviewed_by, review_note from documents where id=$1`,
      [docA]
    );
    expect(row?.reviewed_by).toBe("op@probe.invalid");
    expect(row?.review_note).toContain("20-page technical volume");
  });

  it("refuses a review that records nothing", async () => {
    // Clearing a blocker without saying what was found is worth less than the
    // blocker it cleared.
    for (const note of ["", "   ", undefined]) {
      const res = await call(docA, { action: "review", note });
      expect(res.status, String(note)).toBe(400);
    }
    const row = await queryOne<{ reviewed_by: string | null }>(
      `select reviewed_by from documents where id=$1`,
      [docA]
    );
    expect(row?.reviewed_by).toBeNull();
  });

  it("refuses an exclusion with no reason", async () => {
    const res = await call(docA, { action: "exclude", reason: "  " });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("cannot be told apart from a lost file");
  });

  it("excludes with a reason and records who decided", async () => {
    const res = await call(docA, { action: "exclude", reason: "Duplicate of Attachment 2." });
    expect(res.status).toBe(200);
    const row = await queryOne<{ disposition: string; excluded_reason: string; excluded_by: string }>(
      `select disposition, excluded_reason, excluded_by from documents where id=$1`,
      [docA]
    );
    expect(row?.disposition).toBe("excluded");
    expect(row?.excluded_reason).toBe("Duplicate of Attachment 2.");
    expect(row?.excluded_by).toBe("op@probe.invalid");
  });

  it("marks one document as replaced by another and keeps both", async () => {
    const res = await call(docA, { action: "supersede", supersededBy: docB });
    expect(res.status).toBe(200);
    const rows = await query<{ id: string; superseded_by: string | null }>(
      `select id, superseded_by from documents where id = any($1::uuid[])`,
      [[docA, docB]]
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === docA)?.superseded_by).toBe(docB);
  });

  it("refuses to let a document replace itself", async () => {
    expect((await call(docA, { action: "supersede", supersededBy: docA })).status).toBe(400);
  });

  it("refuses a replacement from another organization, as not found", async () => {
    /*
     * Not a validation message. The replacement id arrives in a request body,
     * and confirming that an id exists somewhere else is the same leak as
     * confirming it on the document itself.
     */
    const res = await call(docA, { action: "supersede", supersededBy: docElsewhere });
    expect(res.status).toBe(404);
  });

  it("refuses to touch another organization's document", async () => {
    const res = await call(docElsewhere, { action: "review", note: "mine now" });
    expect(res.status).toBe(404);
    const row = await queryOne<{ reviewed_by: string | null }>(
      `select reviewed_by from documents where id=$1`,
      [docElsewhere]
    );
    expect(row?.reviewed_by).toBeNull();
  });

  it("refuses a viewer, who can read the bid but not judge it", async () => {
    signIn(org, "viewer");
    const res = await call(docA, { action: "review", note: "looks fine to me" });
    expect(res.status).toBe(403);
    signIn(org, "owner");
  });

  it("refuses an action it does not have", async () => {
    expect((await call(docA, { action: "delete_everything" })).status).toBe(400);
    expect((await call(docA, {})).status).toBe(400);
  });
});
