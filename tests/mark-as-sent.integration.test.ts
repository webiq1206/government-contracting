/**
 * "Submitted" has to mean something.
 *
 * For almost every solicitation this product handles, Brost Co does not submit
 * anything. A person opens a government portal, uploads the files themselves,
 * and comes back. The button said "Submit bid package", the endpoint ran
 * `update bids set submitted_at=now()`, and the only thing that had actually
 * happened was somebody pressing a button in a different application.
 *
 * A bid recorded as submitted with no evidence is worse than one recorded as
 * ready, because the first stops anybody checking.
 *
 * Run against a real database: the last line of defence is a check
 * constraint, and a constraint that is not there looks identical from
 * application code to one that is.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../lib/auth";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../lib/auth")>()),
  currentUser: async () => CURRENT,
}));

d("marking a package as sent", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/opportunities/[id]/sent/route").POST;

  const org = randomUUID();
  const otherOrg = randomUUID();
  const opp = randomUUID();
  const otherOpp = randomUUID();
  let bidId = "";
  let receiptId = "";
  let foreignReceiptId = "";

  const good = {
    method: "portal",
    destination: "SAM.gov",
    sentAt: "2026-08-26T19:02:00.000Z",
    timezone: "America/Chicago",
    confirmationNumber: "4471-A",
    attestation: "Uploaded all six files and saw the success screen.",
  };

  const call = (body: unknown) =>
    POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), {
      params: { id: opp },
    });

  const signIn = (orgId: string, orgRole = "owner") => {
    CURRENT = {
      id: randomUUID(), email: "op@probe.invalid", name: "Op", role: "member",
      orgRole, organizationId: orgId, subscriptionStatus: "active",
      planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  };

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    ({ POST } = await import("../app/api/opportunities/[id]/sent/route"));
    for (const [id, name] of [[org, "Sent A"], [otherOrg, "Sent B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    for (const [id, o] of [[opp, org], [otherOpp, otherOrg]] as const) {
      await query(
        `insert into opportunities (id, org_id, title, source, stage)
         values ($1,$2,'Send probe','test','submission') on conflict (id) do nothing`,
        [id, o]
      );
    }
    const r = await queryOne<{ id: string }>(
      `insert into documents (org_id, opportunity_id, kind, name, storage_path, disposition, extraction_state)
       values ($1,$2,'receipt','portal-receipt.png','r/1.png','delivered','not_applicable')
       returning id`,
      [org, opp]
    );
    receiptId = r!.id;
    const f = await queryOne<{ id: string }>(
      `insert into documents (org_id, opportunity_id, kind, name, storage_path, disposition, extraction_state)
       values ($1,$2,'receipt','their-receipt.png','r/2.png','delivered','not_applicable')
       returning id`,
      [otherOrg, otherOpp]
    );
    foreignReceiptId = f!.id;
    signIn(org);
  });

  beforeEach(async () => {
    await query(`delete from bid_submission_events where org_id = $1`, [org]);
    await query(`delete from bids where opportunity_id = $1`, [opp]);
    const b = await queryOne<{ id: string }>(
      `insert into bids (org_id, opportunity_id, submission_state, requirements_fingerprint)
       values ($1,$2,'approved','fingerprint-v1') returning id`,
      [org, opp]
    );
    bidId = b!.id;
  });

  afterAll(async () => {
    await query(`delete from bid_submission_events where org_id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    await query(`delete from bids where opportunity_id = any($1::uuid[])`, [[opp, otherOpp]]).catch(() => {});
    await query(`delete from documents where org_id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    await query(`delete from opportunities where id = any($1::uuid[])`, [[opp, otherOpp]]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[org, otherOrg]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  const state = () =>
    queryOne<{
      submission_state: string;
      submitted_at: Date | null;
      submitted_package_hash: string | null;
      submitted_by: string | null;
    }>(
      `select submission_state, submitted_at, submitted_package_hash, submitted_by
         from bids where id=$1`,
      [bidId]
    );

  it("records the send with everything that proves it", async () => {
    const res = await call({ ...good, proofDocumentId: receiptId });
    expect(res.status).toBe(200);
    const row = await state();
    expect(row?.submission_state).toBe("sent");
    expect(row?.submitted_at).toBeInstanceOf(Date);
    // Which version went. Without it a package rebuilt after an amendment is
    // indistinguishable from the one that was uploaded.
    expect(row?.submitted_package_hash).toBe("fingerprint-v1");
    expect(row?.submitted_by).toBe("op@probe.invalid");
  });

  it.each([
    [{ method: undefined }, "how it was sent"],
    [{ destination: "   " }, "where it was sent"],
    [{ sentAt: undefined }, "the date and time"],
    [{ timezone: undefined }, "the timezone"],
    [{ attestation: "" }, "your confirmation of what you did"],
  ])("refuses when %j is missing, and sets nothing", async (missing, phrase) => {
    const res = await call({ ...good, proofDocumentId: receiptId, ...missing });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(phrase);
    const row = await state();
    expect(row?.submission_state).toBe("approved");
    expect(row?.submitted_at).toBeNull();
  });

  it("refuses without a receipt", async () => {
    // Every portal produces a screen that can be captured, so this is the one
    // piece of evidence it is fair to insist on.
    const res = await call(good);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("receipt, screenshot or confirmation email");
    expect((await state())?.submitted_at).toBeNull();
  });

  it("does not require a confirmation number", async () => {
    /*
     * Plenty of portals do not issue one, and demanding it pushes operators
     * into typing something untrue into a field that exists to be evidence.
     */
    const res = await call({ ...good, confirmationNumber: "", proofDocumentId: receiptId });
    expect(res.status).toBe(200);
  });

  it("refuses a receipt that belongs to another opportunity", async () => {
    // A document id in a request body proves nothing, and a receipt from a
    // different bid is not evidence about this one.
    const res = await call({ ...good, proofDocumentId: foreignReceiptId });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("not a document on this opportunity");
  });

  it("refuses to skip approval", async () => {
    await query(`update bids set submission_state='package_ready' where id=$1`, [bidId]);
    const res = await call({ ...good, proofDocumentId: receiptId });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("Approve the package first");
  });

  it("refuses a second send of a package already sent", async () => {
    await call({ ...good, proofDocumentId: receiptId });
    const again = await call({ ...good, proofDocumentId: receiptId });
    expect(again.status).toBe(409);
  });

  it("refuses another organization's opportunity", async () => {
    signIn(otherOrg);
    const res = await call({ ...good, proofDocumentId: receiptId });
    expect(res.status).toBe(404);
    signIn(org);
  });

  it("refuses a user who cannot submit", async () => {
    signIn(org, "viewer");
    expect((await call({ ...good, proofDocumentId: receiptId })).status).toBe(403);
    signIn(org);
  });

  it("writes an audit line saying what is proven, not what the state is called", async () => {
    await call({ ...good, proofDocumentId: receiptId });
    const ev = await queryOne<{ to_state: string; actor: string; proof: string }>(
      `select to_state, actor, proof from bid_submission_events where bid_id=$1`,
      [bidId]
    );
    expect(ev?.to_state).toBe("sent");
    expect(ev?.actor).toBe("op@probe.invalid");
    expect(ev?.proof).toContain("Uploaded to a government portal");
    expect(ev?.proof).toContain("SAM.gov");
    expect(ev?.proof).toContain("confirmation 4471-A");
    expect(ev?.proof).toContain("the agency has not acknowledged it");
  });

  it("cannot be worked around by writing submitted_at directly", async () => {
    /*
     * The last line of defence. The endpoint is one caller; the constraint is
     * a claim about the world, so anything that wants to say "this bid was
     * submitted" has to be able to say how.
     */
    await expect(
      query(`update bids set submitted_at=now() where id=$1`, [bidId])
    ).rejects.toThrow(/bids_submitted_evidence_ck/);
  });
});
