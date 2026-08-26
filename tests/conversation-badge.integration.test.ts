/**
 * The sidebar badge and the Communications page must count the same thing.
 *
 * `inboxNeedsReplyCount` used to call `conversationList()` and filter it, on
 * the reasoning that a badge computed a second way is a badge that eventually
 * disagrees with the page it points at. The reasoning is right; the mechanism
 * was not. That list builds every thread's subject, preview body,
 * subcontractor and opportunity joins, and an unread count from a subquery
 * correlated per thread, and it renders in the shell of every signed-in page.
 * Measured at 20,000 messages it added 1.7 seconds to every route in the
 * product, including ones with no conversations on them: /settings/profile
 * went from 23ms to 1,846ms.
 *
 * The badge now runs a facts-only query and feeds the rows to the same
 * `verdict()` the list feeds. That keeps one definition of "needs a reply",
 * and this test is what keeps it honest: it builds the cases that separate
 * needs_reply from the states that look like it, and requires the two paths to
 * return the same number. Re-expressing the predicate in SQL would pass a
 * count test and fail this one the first time the state machine changed.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("the needs-reply badge (integration)", () => {
  let query: typeof import("../lib/db").query;
  let runWithOrg: typeof import("../lib/tenant-context").runWithOrg;
  let conversationList: typeof import("../lib/conversations").conversationList;
  let inboxNeedsReplyCount: typeof import("../lib/conversations").inboxNeedsReplyCount;

  const TAG = `badge-${randomUUID().slice(0, 8)}`;
  const ORG = randomUUID();
  const SUB = randomUUID();

  const at = (minsAgo: number) => new Date(Date.now() - minsAgo * 60_000).toISOString();

  async function msg(
    thread: string,
    direction: "inbound" | "outbound",
    minsAgo: number,
    extra: Record<string, unknown> = {}
  ) {
    const cols = [
      "org_id", "channel", "direction", "subject", "body",
      "gmail_thread_id", "subcontractor_id", "created_at",
    ];
    const vals: unknown[] = [
      ORG, "email", direction, `${TAG} ${thread}`, "body", thread, SUB, at(minsAgo),
    ];
    for (const [k, v] of Object.entries(extra)) {
      cols.push(k);
      vals.push(v);
    }
    await query(
      `insert into communications (${cols.join(",")})
       values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      vals
    );
  }

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ runWithOrg } = await import("../lib/tenant-context"));
    ({ conversationList, inboxNeedsReplyCount } = await import("../lib/conversations"));

    await query(
      `insert into organizations (id, name, subscription_status) values ($1, $2, 'active')`,
      [ORG, `${TAG} org`]
    );
    await query(
      `insert into subcontractors (id, org_id, company_name) values ($1, $2, $3)`,
      [SUB, ORG, `${TAG} sub`]
    );

    // They wrote last and nothing went back.
    await msg(`${TAG}-1`, "outbound", 120);
    await msg(`${TAG}-1`, "inbound", 30);
    // We wrote last: their turn, not ours.
    await msg(`${TAG}-2`, "inbound", 120);
    await msg(`${TAG}-2`, "outbound", 30);
    // They wrote last, but our last message bounced. The bounce is the story.
    await msg(`${TAG}-3`, "outbound", 120, { delivery_state: "bounced" });
    await msg(`${TAG}-3`, "inbound", 30);
    // They wrote last, and somebody marked it finished afterwards.
    await msg(`${TAG}-4`, "outbound", 120);
    await msg(`${TAG}-4`, "inbound", 30);
    await query(
      `insert into conversation_flags (org_id, thread_key, resolved_at) values ($1, $2, now())`,
      [ORG, `${TAG}-4`]
    );
    // Two of theirs in a row, never answered.
    await msg(`${TAG}-5`, "inbound", 90);
    await msg(`${TAG}-5`, "inbound", 20);
  });

  afterAll(async () => {
    await query(`delete from communications where org_id = $1`, [ORG]);
    await query(`delete from conversation_flags where org_id = $1`, [ORG]);
    await query(`delete from subcontractors where org_id = $1`, [ORG]);
    await query(`delete from organizations where id = $1`, [ORG]);
  });

  it("counts exactly what the page counts", async () => {
    await runWithOrg(ORG, async () => {
      const list = await conversationList();
      const fromList = list.filter((c) => c.state === "needs_reply").length;
      const badge = await inboxNeedsReplyCount();
      expect(badge).toBe(fromList);
    });
  });

  it("counts the two threads that are actually waiting on us", async () => {
    /*
     * Pinned as an absolute number as well as against the list, so a change
     * that broke both in the same direction still fails. Agreement alone is
     * satisfied by two functions that are both wrong.
     */
    await runWithOrg(ORG, async () => {
      expect(await inboxNeedsReplyCount()).toBe(2);
    });
  });

  it("does not count a thread whose last message to them bounced", async () => {
    await runWithOrg(ORG, async () => {
      const list = await conversationList();
      const t3 = list.find((c) => c.threadKey === `${TAG}-3`);
      expect(t3?.state).toBe("delivery_failed");
    });
  });

  it("does not count a thread somebody marked finished after they wrote", async () => {
    await runWithOrg(ORG, async () => {
      const list = await conversationList();
      const t4 = list.find((c) => c.threadKey === `${TAG}-4`);
      expect(t4?.state).toBe("resolved");
    });
  });

  it("still agrees once a reply goes out", async () => {
    // The transition is where a second definition would drift first.
    await msg(`${TAG}-1`, "outbound", 1);
    await runWithOrg(ORG, async () => {
      const list = await conversationList();
      const fromList = list.filter((c) => c.state === "needs_reply").length;
      expect(await inboxNeedsReplyCount()).toBe(fromList);
      expect(fromList).toBe(1);
    });
  });
});
