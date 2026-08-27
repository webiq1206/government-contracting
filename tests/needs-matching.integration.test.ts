/**
 * A customer message must not disappear into a log.
 *
 * The poller already refused to drop an unmatched reply silently: when the
 * sender was on the roster it wrote a warning to `agent_logs`. That was better
 * than nothing and still the wrong home. An agent log is a stream somebody
 * reads when the automation is misbehaving, not a queue of work: the line
 * scrolls away, it carries no body, and the only instruction it can give is
 * "go and look in the mailbox".
 *
 * Run against a real database because the properties that matter here are a
 * unique index, two check constraints and a tenant boundary, and none of those
 * exist in a mock.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const LIVE = !!process.env.DATABASE_URL && !!process.env.ALLOW_TESTS_AGAINST_DATABASE_URL;
const d = LIVE ? describe : describe.skip;

d("the Needs matching inbox", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let inbox: typeof import("../lib/needs-matching");

  const orgA = randomUUID();
  const orgB = randomUUID();
  const oppA = randomUUID();
  const oppB = randomUUID();
  const subA = randomUUID();

  const file = (over: Record<string, unknown> = {}) =>
    inbox.recordUnmatched({
      orgId: orgA,
      fromEmail: "estimating@acme-electric.invalid",
      fromName: "Acme Electric",
      subject: "Re: Quote request",
      body: "We can do the electrical but not the controls.",
      messageId: `<probe-${randomUUID()}@mail.invalid>`,
      ...over,
    });

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    inbox = await import("../lib/needs-matching");
    for (const [id, name] of [[orgA, "Inbox A"], [orgB, "Inbox B"]] as const) {
      await query(
        `insert into organizations (id, name, subscription_status, billing_exempt)
         values ($1,$2,'active',true) on conflict (id) do nothing`,
        [id, name]
      );
    }
    for (const [id, org] of [[oppA, orgA], [oppB, orgB]] as const) {
      await query(
        `insert into opportunities (id, org_id, title, source, stage)
         values ($1,$2,'Inbox probe','test','outreach') on conflict (id) do nothing`,
        [id, org]
      );
    }
    await query(
      `insert into subcontractors (id, org_id, company_name, email)
       values ($1,$2,'Acme Electric','estimating@acme-electric.invalid')
       on conflict (id) do nothing`,
      [subA, orgA]
    );
  });

  beforeEach(async () => {
    await query(`delete from unmatched_inbound where org_id = any($1::uuid[])`, [[orgA, orgB]]);
    await query(`delete from communications where org_id = any($1::uuid[])`, [[orgA, orgB]]);
  });

  afterAll(async () => {
    await query(`delete from unmatched_inbound where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    await query(`delete from communications where org_id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    await query(`delete from subcontractors where id = $1`, [subA]).catch(() => {});
    await query(`delete from opportunities where id = any($1::uuid[])`, [[oppA, oppB]]).catch(() => {});
    await query(`delete from organizations where id = any($1::uuid[])`, [[orgA, orgB]]).catch(() => {});
    const { closePool } = await import("../lib/db");
    await closePool().catch(() => {});
  });

  it("keeps the message itself, not just that one arrived", async () => {
    // The whole decision is "what is this about", and that is not answerable
    // from a sender and a subject.
    await file();
    const [msg] = await inbox.needsMatching(orgA);
    expect(msg.subject).toBe("Re: Quote request");
    expect(msg.snippet).toContain("not the controls");
    expect(msg.fromEmail).toBe("estimating@acme-electric.invalid");
  });

  it("is idempotent when the mailbox is polled twice", async () => {
    /*
     * A poll that restarts mid-batch re-reads messages it already handled. Two
     * rows for one message is an operator placing the same reply twice, or
     * worse, dismissing one copy and leaving the other.
     */
    const messageId = "<same-message@mail.invalid>";
    const first = await file({ messageId });
    const second = await file({ messageId });
    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(await inbox.needsMatchingCount(orgA)).toBe(1);
  });

  it("files a message with no Message-ID rather than dropping it", async () => {
    /*
     * It cannot be deduplicated, so it arrives twice. That is the honest
     * trade: a duplicate an operator can dismiss is better than a reply lost
     * because it lacked a header.
     */
    await file({ messageId: null });
    await file({ messageId: null });
    expect(await inbox.needsMatchingCount(orgA)).toBe(2);
  });

  it("files a stranger's message, not only a known subcontractor's", async () => {
    // A firm writing from an address we have never seen is exactly the message
    // most likely to be lost, and it is the one a roster check misses.
    await file({ fromEmail: "someone@unknown-firm.invalid", subcontractorId: null });
    const [msg] = await inbox.needsMatching(orgA);
    expect(msg.subcontractorId).toBeNull();
    expect(msg.fromEmail).toBe("someone@unknown-firm.invalid");
  });

  it("names the subcontractor when it knows them", async () => {
    await file({ subcontractorId: subA });
    const [msg] = await inbox.needsMatching(orgA);
    expect(msg.subcontractorName).toBe("Acme Electric");
  });

  it("places a message as a real reply on the opportunity", async () => {
    /*
     * A communication row rather than a note, so the conversation, the
     * coverage and the timeline all see it without knowing it arrived by hand.
     */
    const id = (await file({ subcontractorId: subA }))!;
    const placed = await inbox.matchMessage(id, orgA, oppA, "op@probe.invalid");
    expect(placed?.communicationId).toBeTruthy();

    const comm = await queryOne<{ direction: string; opportunity_id: string; subcontractor_id: string }>(
      `select direction, opportunity_id, subcontractor_id from communications where id=$1`,
      [placed!.communicationId]
    );
    expect(comm?.direction).toBe("inbound");
    expect(comm?.opportunity_id).toBe(oppA);
    expect(comm?.subcontractor_id).toBe(subA);
    expect(await inbox.needsMatchingCount(orgA)).toBe(0);
  });

  it("refuses to place a message against another organization's opportunity", async () => {
    // The opportunity id arrives in a request body and is not proof of
    // anything on its own.
    const id = (await file())!;
    expect(await inbox.matchMessage(id, orgA, oppB, "op@probe.invalid")).toBeNull();
    expect(await inbox.needsMatchingCount(orgA)).toBe(1);
  });

  it("refuses to place another organization's message", async () => {
    const id = (await file())!;
    expect(await inbox.matchMessage(id, orgB, oppB, "op@probe.invalid")).toBeNull();
  });

  it("keeps one organization's inbox invisible to another", async () => {
    await file();
    expect(await inbox.needsMatching(orgB)).toEqual([]);
    expect(await inbox.needsMatchingCount(orgB)).toBe(0);
  });

  it("refuses a dismissal with no reason", async () => {
    /*
     * "Not ours" with no reason is indistinguishable from a message nobody
     * could be bothered to read, and the whole value of this inbox is that the
     * difference is visible.
     */
    const id = (await file())!;
    for (const reason of ["", "   "]) {
      expect(await inbox.dismissMessage(id, orgA, reason, "op@probe.invalid")).toBe(false);
    }
    expect(await inbox.needsMatchingCount(orgA)).toBe(1);
  });

  it("records who dismissed it and why", async () => {
    const id = (await file())!;
    expect(
      await inbox.dismissMessage(id, orgA, "Newsletter, not a reply to us.", "op@probe.invalid")
    ).toBe(true);
    const row = await queryOne<{ state: string; dismissed_reason: string; dismissed_by: string }>(
      `select state, dismissed_reason, dismissed_by from unmatched_inbound where id=$1`,
      [id]
    );
    expect(row?.state).toBe("dismissed");
    expect(row?.dismissed_reason).toContain("Newsletter");
    expect(row?.dismissed_by).toBe("op@probe.invalid");
    expect(await inbox.needsMatchingCount(orgA)).toBe(0);
  });

  it("cannot be dismissed twice, or after being placed", async () => {
    const id = (await file())!;
    await inbox.dismissMessage(id, orgA, "Newsletter.", "op@probe.invalid");
    expect(await inbox.dismissMessage(id, orgA, "Again.", "op@probe.invalid")).toBe(false);
    expect(await inbox.matchMessage(id, orgA, oppA, "op@probe.invalid")).toBeNull();
  });

  it("shows the oldest first, because that one has cost the most", async () => {
    // The opposite of a mailbox, and the right order for a queue.
    await file({ messageId: "<new@x>", receivedAt: new Date("2026-08-26T12:00:00Z"), subject: "newer" });
    await file({ messageId: "<old@x>", receivedAt: new Date("2026-08-20T12:00:00Z"), subject: "older" });
    const list = await inbox.needsMatching(orgA);
    expect(list.map((m) => m.subject)).toEqual(["older", "newer"]);
  });

  it("refuses a row that claims to be matched to nothing", async () => {
    // Enforced underneath, so no caller can write the state without the fact.
    const id = (await file())!;
    await expect(
      query(`update unmatched_inbound set state='matched' where id=$1`, [id])
    ).rejects.toThrow(/unmatched_inbound_matched_ck/);
  });
});
