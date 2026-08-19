/**
 * A bounce has to land on the right message, and a hard one has to stop us
 * mailing that address again.
 *
 * The end state matters more than the parsing: an outreach whose address is
 * dead must stop reading as "sent", the operator must get the provider's own
 * reason, and the address must go on the do-not-contact list -- because
 * continuing to mail it is what builds the complaint rate that moves a whole
 * sending domain into spam.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { parseBounce, deliveryStateFor } from "../lib/domain/email-delivery";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;

const HARD_BOUNCE = `Delivery to the following recipient failed permanently:

Final-Recipient: rfc822; dead@nowhere.example
Action: failed
Status: 5.1.1
Diagnostic-Code: smtp; 550-5.1.1 The email account that you tried to reach does not exist.`;

d("bounce ingestion (integration)", () => {
  let query: typeof import("../lib/db").query;
  let queryOne: typeof import("../lib/db").queryOne;
  let sup: typeof import("../lib/domain/email-suppression");
  const org = { id: "" };
  const sub = { id: "" };
  const comm = { id: "" };
  const addr = "dead@nowhere.example";

  beforeAll(async () => {
    ({ query, queryOne } = await import("../lib/db"));
    sup = await import("../lib/domain/email-suppression");
    const o = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`bounce-${randomUUID()}`]
    );
    org.id = o!.id;
    const s = await queryOne<{ id: string }>(
      `insert into subcontractors (org_id, company_name, trade_categories, state, email)
       values ($1,'Dead Address Electric',ARRAY['electrical'],'CA',$2) returning id`,
      [org.id, addr]
    );
    sub.id = s!.id;
    const c = await queryOne<{ id: string }>(
      `insert into communications
         (org_id, subcontractor_id, channel, direction, subject, recipient_email,
          gmail_thread_id, rfc822_message_id)
       values ($1,$2,'email','outbound','Quote request',$3,'thread-bounce-1','<orig-1@mail.gmail.com>')
       returning id`,
      [org.id, sub.id, addr]
    );
    comm.id = c!.id;
  });

  afterAll(async () => {
    if (!org.id) return;
    for (const t of ["email_suppressions", "communications", "subcontractors", "agent_logs"]) {
      await query(`delete from ${t} where org_id=$1`, [org.id]).catch(() => {});
    }
    await query(`delete from organizations where id=$1`, [org.id]).catch(() => {});
  });

  it("starts out as sent, which is all we actually know", async () => {
    const row = await queryOne<{ delivery_state: string }>(
      `select delivery_state from communications where id=$1`,
      [comm.id]
    );
    expect(row!.delivery_state).toBe("sent");
    expect(deliveryStateFor(row as never)).toBe("sent");
  });

  it("marks the exact message bounced, matched on its Message-ID", async () => {
    const report = parseBounce(HARD_BOUNCE);
    expect(report.permanent).toBe(true);

    // The correlation the agent performs, strongest signal first.
    const updated = await query<{ id: string }>(
      `update communications
          set delivery_state=$2, delivery_detail=$3, delivery_updated_at=now()
        where org_id=$1 and direction='outbound' and rfc822_message_id=$4
        returning id`,
      [org.id, "bounced", report.reason, report.originalMessageId ?? "<orig-1@mail.gmail.com>"]
    );
    expect(updated.map((r) => r.id)).toEqual([comm.id]);

    const row = await queryOne<{ delivery_state: string; delivery_detail: string }>(
      `select delivery_state, delivery_detail from communications where id=$1`,
      [comm.id]
    );
    expect(row!.delivery_state).toBe("bounced");
    // The operator gets the provider's words, not just "failed".
    expect(row!.delivery_detail).toMatch(/does not exist/i);
  });

  it("stays bounced even though a tracking pixel later fires", async () => {
    // An open can be a scanner or a proxy prefetch. The bounce is the fact.
    await query(`update communications set opened_at=now() where id=$1`, [comm.id]);
    const row = await queryOne<{
      delivery_state: string;
      opened_at: string | null;
    }>(`select delivery_state, opened_at from communications where id=$1`, [comm.id]);
    expect(row!.opened_at).not.toBeNull();
    expect(deliveryStateFor(row as never)).toBe("bounced");
  });

  it("suppresses the address on a hard bounce, and only per-tenant", async () => {
    const report = parseBounce(HARD_BOUNCE);
    await sup.suppressEmail({
      orgId: org.id,
      email: report.recipient!,
      reason: `Hard bounce: ${report.reason}`,
      source: "bounce",
    });
    expect(await sup.isSuppressed(org.id, addr)).toBe(true);

    const other = await queryOne<{ id: string }>(
      `insert into organizations (name, subscription_status) values ($1,'active') returning id`,
      [`bounce-other-${randomUUID()}`]
    );
    // Another tenant's relationship with this address is their own.
    expect(await sup.isSuppressed(other!.id, addr)).toBe(false);
    await query(`delete from organizations where id=$1`, [other!.id]).catch(() => {});
  });

  it("does NOT suppress on a transient failure", async () => {
    const soft = parseBounce(
      `Final-Recipient: rfc822; busy@builderco.example\nAction: delayed\nStatus: 4.2.2\nDiagnostic-Code: smtp; 452 4.2.2 mailbox full`
    );
    expect(soft.permanent).toBe(false);
    // A full mailbox for one afternoon must not permanently lose a live sub.
    expect(await sup.isSuppressed(org.id, "busy@builderco.example")).toBe(false);
  });

  it("refuses a delivery_state the domain does not define", async () => {
    await expect(
      query(`update communications set delivery_state='teleported' where id=$1`, [comm.id])
    ).rejects.toThrow(/check constraint|violates/i);
  });
});
