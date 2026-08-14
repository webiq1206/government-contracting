/**
 * Two-organization isolation proof for inbound reply capture.
 *
 * A reply is correlated by tracking token, then Gmail thread, then the sender's
 * own email address. That last one is the problem: an address is not unique to
 * a tenant. The same electrician is on several customers' rosters and gets
 * outreach from all of them, so one customer's inbox poll could match another
 * customer's outbound email and write the reply onto their opportunity.
 *
 * The sender picks the victim by choosing when to reply, and neither customer
 * would see anything odd: one gets a reply they never received, the other never
 * learns their subcontractor answered.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";

const SHARED_EMAIL = `shared-${randomUUID().slice(0, 8)}@example-sub.test`;
const B_ONLY_EMAIL = `orgb-only-${randomUUID().slice(0, 8)}@example-sub.test`;

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

d("reply capture stays inside one organization (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let cap: typeof import("../lib/reply-capture");

  const orgA = { id: "", name: `replyiso-a-${randomUUID()}`, opp: "", sub: "", comm: "", token: randomUUID() };
  const orgB = { id: "", name: `replyiso-b-${randomUUID()}`, opp: "", sub: "", comm: "", bOnlySub: "" };

  const fakeExtract = async () => ({
    intent: "quote" as const,
    isQuote: true,
    quoteAmount: 55555,
    paymentTerms: null,
    notes: null,
    companyName: "Shared Sub LLC",
    canPerform: true,
    capabilityNotes: null,
    tradesMentioned: [] as string[],
    method: "ai" as const,
  });

  async function makeOrg(o: { id: string; name: string; opp: string; sub: string; comm: string }) {
    const org = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1, 'active') returning id`,
      [o.name]
    );
    o.id = org!.id;
    const opp = await queryOne<{ id: string }>(
      `insert into opportunities (org_id, title, stage, source, status)
       values ($1, $2, 'outreach', 'manual', 'open') returning id`,
      [o.id, `${o.name} opportunity`]
    );
    o.opp = opp!.id;
    // Both organizations have the same firm on their roster, which is normal.
    const sub = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email, email_verified)
       values ($1, $2, $3, true) returning id`,
      [o.id, `${o.name} shared sub`, SHARED_EMAIL]
    );
    o.sub = sub!.id;
    await query(
      `insert into opportunity_subs (opportunity_id, subcontractor_id, trade, outreach_state)
       values ($1,$2,'electrical','sent')`,
      [o.opp, o.sub]
    );
  }

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    cap = await import("../lib/reply-capture");

    await makeOrg(orgA);
    await makeOrg(orgB);

    // Org A's outreach, with no tracking token and no thread: the weak path.
    const commA = await queryOne<{ id: string }>(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, provider)
       values ($1,$2,$3,'email','outbound','A outreach','body','resend') returning id`,
      [orgA.id, orgA.sub, orgA.opp]
    );
    orgA.comm = commA!.id;

    // Org B's outreach to the same firm, sent LATER. The unscoped match orders
    // by recency, so this is the row it would have picked.
    const commB = await queryOne<{ id: string }>(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, provider, created_at)
       values ($1,$2,$3,'email','outbound','B outreach','body','resend', now() + interval '1 minute') returning id`,
      [orgB.id, orgB.sub, orgB.opp]
    );
    orgB.comm = commB!.id;

    // A firm only org B knows, and an org A outreach with no linked sub. A
    // reply from that address is how another org's roster row gets adopted.
    const bOnly = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, email, email_verified)
       values ($1, 'ORGB ONLY SUB', $2, true) returning id`,
      [orgB.id, B_ONLY_EMAIL]
    );
    orgB.bOnlySub = bOnly!.id;
    await query(
      `insert into communications (org_id, subcontractor_id, opportunity_id, channel, direction, subject, body, tracking_id, provider)
       values ($1,null,$2,'email','outbound','A unlinked outreach','body',$3,'resend')`,
      [orgA.id, orgA.opp, orgA.token]
    );
  });

  afterAll(async () => {
    for (const o of [orgA, orgB]) {
      if (!o.id) continue;
      await query(`delete from quotes where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from communications where org_id = $1`, [o.id]).catch(() => {});
      await query(
        `delete from opportunity_subs where opportunity_id in
           (select id from opportunities where org_id = $1)`,
        [o.id]
      ).catch(() => {});
      await query(`delete from call_cards where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from agent_logs where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from opportunities where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from subcontractors where org_id = $1`, [o.id]).catch(() => {});
      await query(`delete from organizations where id = $1`, [o.id]).catch(() => {});
    }
  });

  it("matches a sender-only reply against the polling organization's own outreach", async () => {
    // Org A polls its own inbox. Org B's outreach to the same address is newer,
    // so an unscoped match by recency picks org B's conversation instead.
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: orgA.id,
      fromEmail: SHARED_EMAIL,
    });
    expect(strongMatch).toBe(false);
    expect(comm?.id).toBe(orgA.comm);
    expect(comm?.opportunity_id).toBe(orgA.opp);
  });

  it("writes the captured reply onto the polling organization's record only", async () => {
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: orgA.id,
      fromEmail: SHARED_EMAIL,
    });
    await cap.captureReply({
      orgId: orgA.id,
      comm: comm!,
      strongMatch,
      fromEmail: SHARED_EMAIL,
      replyText: "Quoting $55,555.",
      messageId: `iso-msg-${randomUUID()}`,
      extract: fakeExtract,
    });

    const inbound = await query<{ org_id: string | null; opportunity_id: string }>(
      `select org_id, opportunity_id from communications where direction='inbound'
        and opportunity_id in ($1, $2)`,
      [orgA.opp, orgB.opp]
    );
    expect(inbound.length).toBe(1);
    expect(inbound[0].org_id).toBe(orgA.id);
    expect(inbound[0].opportunity_id).toBe(orgA.opp);

    // Org B never received a reply, so its outreach must still be open.
    const b = await queryOne<{ replied_at: string | null }>(
      `select replied_at from communications where id = $1`,
      [orgB.comm]
    );
    expect(b?.replied_at).toBeNull();
  });

  it("never adopts another organization's subcontractor onto this opportunity", async () => {
    // The reply carries org A's tracking token, so the conversation is org A's
    // beyond doubt. Only the sender is unknown to org A, and that address
    // happens to be on org B's roster.
    const { comm, strongMatch } = await cap.matchInboundReply({
      orgId: orgA.id,
      trackingToken: orgA.token,
      fromEmail: B_ONLY_EMAIL,
    });
    expect(strongMatch).toBe(true);

    const result = await cap.captureReply({
      orgId: orgA.id,
      comm: comm!,
      strongMatch,
      fromEmail: B_ONLY_EMAIL,
      replyText: "Quoting $55,555.",
      messageId: `iso-msg-${randomUUID()}`,
      extract: fakeExtract,
    });

    expect(result.subId).not.toBe(orgB.bOnlySub);
    const created = await queryOne<{ org_id: string | null }>(
      `select org_id from subcontractors where id = $1`,
      [result.subId]
    );
    // A sub with no org is invisible to the roster of the customer whose reply
    // created it, so "not org B's" is only half the requirement.
    expect(created?.org_id).toBe(orgA.id);

    const pairedToB = await query<{ id: string }>(
      `select id from opportunity_subs where opportunity_id = $1 and subcontractor_id = $2`,
      [orgA.opp, orgB.bOnlySub]
    );
    expect(pairedToB.length).toBe(0);
  });
});
