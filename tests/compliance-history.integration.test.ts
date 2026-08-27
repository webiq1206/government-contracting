/**
 * Who changed what, and when.
 *
 * Every edit went to a flat application log this page never reads, so the
 * question a compliance record exists to answer -- who moved this date, and on
 * what authority -- had nowhere to be answered from. On federal work that is
 * the question an auditor asks.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const org = { id: "" };
const user = { id: "", email: "auditor@example.test" };

vi.mock("@/lib/org-guard", () => ({
  requireOrgContext: async () => ({ orgId: org.id, user: { id: user.id, email: user.email } }),
}));
vi.mock("@/lib/logger", () => ({ logAgent: async () => {} }));

d("compliance history (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let POST: typeof import("../app/api/compliance/[id]/route").POST;
  let itemId = "";

  async function edit(body: Record<string, unknown>) {
    return POST(
      new Request("http://x/api", { method: "POST", body: JSON.stringify(body) }),
      { params: { id: itemId } }
    );
  }

  async function events() {
    return query<{ kind: string; summary: string; actor_label: string; changes: unknown }>(
      `select kind, summary, actor_label, changes from compliance_item_events
        where item_id = $1 order by created_at`,
      [itemId]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`hist-${randomUUID()}`]
    );
    org.id = o!.id;
    const u = await queryOne<{ id: string }>(
      `insert into users (email, password_hash) values ($1,'x') returning id`,
      [`hist-${randomUUID()}@example.test`]
    );
    user.id = u!.id;
    const item = await queryOne<{ id: string }>(
      `insert into compliance_items (org_id, category, label, status, recurrence, due_at)
       values ($1,'insurance','General liability','incomplete','annual','2027-03-15') returning id`,
      [org.id]
    );
    itemId = item!.id;
    ({ POST } = await import("../app/api/compliance/[id]/route"));
  });

  afterAll(async () => {
    if (!org.id) return;
    await query(`delete from compliance_items where org_id = $1`, [org.id]).catch(() => {});
    if (user.id) await query(`delete from users where id = $1`, [user.id]).catch(() => {});
    await query(`delete from organizations where id = $1`, [org.id]).catch(() => {});
  });

  it("records what changed, in the words it will be read in", async () => {
    const res = await edit({ due_at_override: "2027-06-30", notes: "Renewed with a new carrier" });
    expect(res.status).toBe(200);
    const ev = await events();
    expect(ev).toHaveLength(1);
    expect(ev[0].summary).toContain("set the renewal date");
    expect(ev[0].summary).toContain("set the notes");
    expect(ev[0].actor_label).toBe(user.email);
  });

  it("does not record a change that did not happen", async () => {
    /*
     * A form that posts every field would otherwise log an edit to each one
     * on every save, and a history full of changes nobody made is one people
     * stop reading.
     */
    const before = (await events()).length;
    await edit({ due_at_override: "2027-06-30", notes: "Renewed with a new carrier" });
    expect((await events()).length).toBe(before);
  });

  it("marks a verification as its own kind, with who made it", async () => {
    await edit({ verified: true });
    const ev = await events();
    const last = ev[ev.length - 1];
    expect(last.kind).toBe("verified");
    // Distinct from last_checked_at, which is when a machine looked.
    const row = await queryOne<{ verified_at: string | null; verified_by: string | null }>(
      `select verified_at::text as verified_at, verified_by::text as verified_by
         from compliance_items where id = $1`,
      [itemId]
    );
    expect(row?.verified_at).toBeTruthy();
    expect(row?.verified_by).toBe(user.id);
  });

  it("rolls a renewal forward from the date that passed", async () => {
    await edit({ renewed: true });
    const row = await queryOne<{ due_at_override: string | null; status_override: string | null }>(
      `select due_at_override::text as due_at_override, status_override
         from compliance_items where id = $1`,
      [itemId]
    );
    // From 2027-06-30, annually, not from today.
    expect(row?.due_at_override?.slice(0, 10)).toBe("2028-06-30");
    // The old override no longer applies to a date that has moved.
    expect(row?.status_override).toBeNull();
  });

  it("refuses to renew an item with no schedule", async () => {
    const plain = await queryOne<{ id: string }>(
      `insert into compliance_items (org_id, category, label, status)
       values ($1,'other','No schedule','incomplete') returning id`,
      [org.id]
    );
    const res = await POST(
      new Request("http://x/api", { method: "POST", body: JSON.stringify({ renewed: true }) }),
      { params: { id: plain!.id } }
    );
    expect(res.status).toBe(400);
  });

  it("will not let a history line be edited or deleted while the item stands", async () => {
    // The point of an audit trail is that it cannot be tidied up afterwards.
    await expect(
      query(`update compliance_item_events set summary = 'nothing happened' where item_id = $1`, [itemId])
    ).rejects.toThrow(/cannot be changed/);
    await expect(
      query(`delete from compliance_item_events where item_id = $1`, [itemId])
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("lets the history go when the item it explains goes", async () => {
    const doomed = await queryOne<{ id: string }>(
      `insert into compliance_items (org_id, category, label, status)
       values ($1,'other','Doomed','incomplete') returning id`,
      [org.id]
    );
    await POST(
      new Request("http://x/api", { method: "POST", body: JSON.stringify({ notes: "hello" }) }),
      { params: { id: doomed!.id } }
    );
    await query(`delete from compliance_items where id = $1`, [doomed!.id]);
    const left = await query(`select id from compliance_item_events where item_id = $1`, [doomed!.id]);
    expect(left).toHaveLength(0);
  });
});
