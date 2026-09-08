/**
 * Billing delivery state against the real schema. No email leaves the test:
 * the platform sender is mocked at the provider boundary.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const hasDb = Boolean(process.env.DATABASE_URL);
const d = hasDb ? describe : describe.skip;
const systemSend = vi.fn();

vi.mock("../lib/integrations/system-mail", () => ({
  systemMail: { send: systemSend },
}));

d("billing notification delivery ledger (integration)", () => {
  const orgId = randomUUID();
  const userEmail = `billing-notify-${randomUUID()}@example.test`;
  const failedEvent = `evt_failed_${randomUUID()}`;
  const sentEvent = `evt_sent_${randomUUID()}`;
  let userId = "";
  let query: typeof import("../lib/db").query;
  let notifyPaymentFailed: typeof import("../lib/billing/notify").notifyPaymentFailed;
  let notifyPaymentSucceeded: typeof import("../lib/billing/notify").notifyPaymentSucceeded;

  beforeAll(async () => {
    ({ query } = await import("../lib/db"));
    ({ notifyPaymentFailed, notifyPaymentSucceeded } = await import("../lib/billing/notify"));
    await query(
      `insert into organizations (id, name, subscription_status)
       values ($1, $2, 'active')`,
      [orgId, `Billing notification ${orgId.slice(0, 8)}`]
    );
    const users = await query<{ id: string }>(
      `insert into users (email, name, password_hash)
       values ($1, 'Billing Owner', 'x') returning id`,
      [userEmail]
    );
    userId = users[0].id;
    await query(
      `insert into organization_members (org_id, user_id, role)
       values ($1, $2, 'owner')`,
      [orgId, userId]
    );
    for (const [eventId, type] of [
      [failedEvent, "invoice.payment_failed"],
      [sentEvent, "invoice.paid"],
    ]) {
      await query(
        `insert into stripe_events (id, type, created_at, org_id, error)
         values ($1, $2, now(), $3, '__processing__')`,
        [eventId, type, orgId]
      );
    }
  });

  afterAll(async () => {
    if (!query) return;
    await query(`delete from agent_logs where org_id = $1`, [orgId]).catch(() => {});
    await query(`delete from stripe_events where id = any($1::text[])`, [
      [failedEvent, sentEvent],
    ]).catch(() => {});
    await query(`delete from organizations where id = $1`, [orgId]).catch(() => {});
    if (userId) await query(`delete from users where id = $1`, [userId]).catch(() => {});
  });

  it("persists a provider failure and does not send it again", async () => {
    systemSend.mockResolvedValueOnce({ error: "Google rejected the grant" });

    await notifyPaymentFailed({
      orgId,
      eventId: failedEvent,
      amountCents: 49700,
      reason: "Card declined",
      nextAttemptAt: null,
      invoiceUrl: null,
    });

    const [event] = await query<{
      notification_status: string;
      notification_kind: string;
      notification_error: string;
    }>(
      `select notification_status, notification_kind, notification_error
         from stripe_events where id = $1 and org_id = $2`,
      [failedEvent, orgId]
    );
    expect(event).toMatchObject({
      notification_status: "failed",
      notification_kind: "payment-failed",
      notification_error: "Google rejected the grant",
    });
    const logs = await query<{ action: string; status: string }>(
      `select action, status from agent_logs
        where org_id = $1 and input_json->>'stripe_event_id' = $2`,
      [orgId, failedEvent]
    );
    expect(logs).toContainEqual({ action: "billing-notification-failed", status: "error" });

    systemSend.mockClear();
    await notifyPaymentFailed({
      orgId,
      eventId: failedEvent,
      amountCents: 49700,
      reason: "Card declined",
      nextAttemptAt: null,
      invoiceUrl: null,
    });
    expect(systemSend).not.toHaveBeenCalled();
  });

  it("persists provider acceptance and its Gmail message id", async () => {
    systemSend.mockResolvedValueOnce({ messageId: "gmail-message-123" });

    await notifyPaymentSucceeded({
      orgId,
      eventId: sentEvent,
      amountCents: 49700,
      invoiceUrl: null,
      periodEnd: null,
    });

    const [event] = await query<{
      notification_status: string;
      notification_kind: string;
      notification_message_id: string;
    }>(
      `select notification_status, notification_kind, notification_message_id
         from stripe_events where id = $1 and org_id = $2`,
      [sentEvent, orgId]
    );
    expect(event).toEqual({
      notification_status: "sent",
      notification_kind: "payment-succeeded",
      notification_message_id: "gmail-message-123",
    });
  });
});
