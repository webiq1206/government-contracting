/**
 * A document id is a UUID somebody can put in a URL.
 *
 * Requirements carry document ids rather than storage paths, so opening the
 * source of a requirement goes through a route that takes an id. That makes
 * the route the single place where "can this account read this file" is
 * decided, which is worth more than threading paths through a dozen
 * components, and worth nothing at all unless the check is really there.
 *
 * Run against a real database because the failure mode is a missing
 * comparison, and a mocked lookup returns whatever it was told to.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { SessionUser } from "../lib/auth";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

let CURRENT: SessionUser | null = null;
vi.mock("../lib/auth", async (orig) => ({
  ...(await orig<typeof import("../lib/auth")>()),
  currentUser: async () => CURRENT,
}));

d("opening a document by id", () => {
  let query: typeof import("../lib/db").query;
  let GET: typeof import("../app/api/documents/[id]/open/route").GET;

  const orgMine = randomUUID();
  const orgTheirs = randomUUID();
  const oppMine = randomUUID();
  const oppTheirs = randomUUID();
  const docMine = randomUUID();
  const docTheirs = randomUUID();
  const docNoBytes = randomUUID();

  const call = (id: string, page?: number) =>
    GET(new Request(`http://x/api/documents/${id}/open${page ? `?page=${page}` : ""}`), {
      params: { id },
    });

  const signedInAs = (org: string) => {
    CURRENT = {
      id: randomUUID(), email: "op@probe.invalid", name: "Op", role: "member",
      orgRole: "owner", organizationId: org, subscriptionStatus: "active",
      planKey: "pro", trialEndsAt: null,
    } as SessionUser;
  };

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ GET } = await import("../app/api/documents/[id]/open/route"));
    for (const [id, name] of [[orgMine, "Mine"], [orgTheirs, "Theirs"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, `Doc route ${name}`]
      );
    }
    for (const [opp, org] of [[oppMine, orgMine], [oppTheirs, orgTheirs]] as const) {
      await query(
        `insert into opportunities (id, org_id, title, source, stage)
         values ($1,$2,'Doc route probe','test','analysis') on conflict (id) do nothing`,
        [opp, org]
      );
    }
    await query(
      `insert into documents (id, org_id, opportunity_id, kind, name, storage_path, disposition, extraction_state)
       values ($1,$2,$3,'solicitation','PWS.pdf','solicitations/mine/1_pws.pdf','delivered','extracted'),
              ($4,$5,$6,'solicitation','Their PWS.pdf','solicitations/theirs/1_pws.pdf','delivered','extracted'),
              ($7,$2,$3,'solicitation','Never stored.pdf',null,'blocked','pending')`,
      [docMine, orgMine, oppMine, docTheirs, orgTheirs, oppTheirs, docNoBytes]
    );
  });

  afterAll(async () => {
    await query(`delete from documents where id = any($1::uuid[])`, [
      [docMine, docTheirs, docNoBytes],
    ]).catch(() => {});
    await query(`delete from opportunities where id = any($1::uuid[])`, [
      [oppMine, oppTheirs],
    ]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [
      [orgMine, orgTheirs],
    ]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("opens my own document at the page the requirement cited", async () => {
    signedInAs(orgMine);
    const res = await call(docMine, 44);
    expect(res.status).toBe(307);
    const to = res.headers.get("location") ?? "";
    expect(to).toContain("/api/files/solicitations/mine/1_pws.pdf");
    // The PDF fragment convention. A viewer that does not understand it opens
    // page one, which is the right way for this to degrade.
    expect(to).toContain("#page=44");
  });

  it("opens without a fragment when there is no page", async () => {
    signedInAs(orgMine);
    const to = (await call(docMine)).headers.get("location") ?? "";
    expect(to).toContain("/api/files/solicitations/mine/1_pws.pdf");
    expect(to).not.toContain("#page");
  });

  it("ignores a page number that is not a page", async () => {
    signedInAs(orgMine);
    for (const bad of [0, -3]) {
      const to = (await call(docMine, bad)).headers.get("location") ?? "";
      expect(to, String(bad)).not.toContain("#page");
    }
  });

  it("refuses another organization's document", async () => {
    /*
     * The whole reason the route exists. Authentication alone is not the
     * question: a signed-in operator of one account asking for another
     * account's document id must be told the same thing as somebody asking
     * for a document that was never there.
     */
    signedInAs(orgMine);
    const res = await call(docTheirs);
    expect(res.status).toBe(404);
    expect(res.headers.get("location")).toBeNull();
  });

  it("says the same thing about a document that does not exist", async () => {
    // Distinguishing the two would confirm that an id exists and belongs to
    // somebody else, which is the fact worth hiding.
    signedInAs(orgMine);
    const missing = await call(randomUUID());
    const theirs = await call(docTheirs);
    expect(missing.status).toBe(theirs.status);
    expect(await missing.json()).toEqual(await theirs.json());
  });

  it("says the same thing about a row whose bytes were never stored", async () => {
    signedInAs(orgMine);
    expect((await call(docNoBytes)).status).toBe(404);
  });
});
