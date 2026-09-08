/**
 * Billing emails to the customer.
 *
 * Sent through the platform inbox, never a tenant's: these are messages from
 * us about their account, and a customer whose card just failed may have no
 * working connection of their own.
 *
 * Delivery is independent from applying the Stripe event. A provider failure
 * never fails the webhook, because Stripe would replay financial state for the
 * sake of an email. The failure is not discarded: each attempt is claimed and
 * settled on stripe_events, with an agent_logs entry for operator attention.
 */
import { systemMail } from "../integrations/system-mail";
import { query, queryOne } from "../db";
import { config } from "../config";

type BillingNotificationKind =
  | "trial-started"
  | "trial-ending"
  | "payment-succeeded"
  | "payment-failed"
  | "subscription-canceled"
  | "subscription-reactivated";

interface NotificationContext {
  orgId: string;
  /** Stripe's event id is the durable idempotency key for this notice. */
  eventId: string;
}

function money(cents: number | null | undefined): string {
  if (cents == null) return "your plan price";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function billingUrl(): string {
  return `${config.appUrl.replace(/\/$/, "")}/settings/billing`;
}

/** Owner email for an organization, or null when there is nobody to tell. */
async function ownerEmail(orgId: string): Promise<{ email: string; name: string | null } | null> {
  return queryOne<{ email: string; name: string | null }>(
    `select u.email, u.name
       from organization_members m
       join users u on u.id = m.user_id
      where m.org_id = $1
      order by case when m.role = 'owner' then 0 else 1 end, m.created_at asc
      limit 1`,
    [orgId]
  );
}

async function recordAttention(input: {
  orgId: string;
  eventId: string;
  kind: BillingNotificationKind;
  message: string;
}): Promise<void> {
  try {
    await query(
      `insert into agent_logs
         (org_id, agent, action, level, status, message, input_json)
       values ($1, 'billing-webhook', 'billing-notification-failed',
               'error', 'error', $2, $3::jsonb)`,
      [
        input.orgId,
        input.message.slice(0, 1000),
        JSON.stringify({ stripe_event_id: input.eventId, notification_kind: input.kind }),
      ]
    );
  } catch (error) {
    // The event row remains the durable source of truth even if the secondary
    // dashboard log cannot be written. Never turn a mail failure into a replay
    // of the Stripe event after the provider has been called.
    console.error(
      `[billing-notify] ${input.eventId} is recorded on stripe_events, but its attention log could not be written:`,
      error
    );
  }
}

async function markNoRecipient(
  input: NotificationContext,
  kind: BillingNotificationKind
): Promise<void> {
  const message =
    "The billing notification was not sent because this account has no owner or member email. Add an account owner, then send the notice manually.";
  const rows = await query<{ id: string }>(
    `update stripe_events
        set org_id = coalesce(org_id, $2),
            notification_kind = $3,
            notification_status = 'failed',
            notification_recipient = null,
            notification_error = $4,
            notification_finished_at = now()
      where id = $1
        and notification_status is null
        and (org_id is null or org_id = $2)
      returning id`,
    [input.eventId, input.orgId, kind, message]
  );
  if (rows.length > 0) {
    await recordAttention({ ...input, kind, message });
    return;
  }

  const existing = await queryOne<{
    org_id: string | null;
    notification_status: "pending" | "sent" | "failed" | null;
  }>(
    `select org_id, notification_status from stripe_events where id = $1`,
    [input.eventId]
  );
  if (!existing) {
    throw new Error(
      `Stripe event ${input.eventId} no longer exists, so its missing recipient could not be recorded.`
    );
  }
  if (existing.org_id && existing.org_id !== input.orgId) {
    throw new Error(
      `Stripe event ${input.eventId} belongs to a different organization, so its missing recipient could not be recorded.`
    );
  }
  if (!existing.notification_status) {
    throw new Error(
      `Stripe event ${input.eventId} could not record its missing billing recipient.`
    );
  }
  if (existing.notification_status !== "sent") {
    await recordAttention({ ...input, kind, message });
  }
}

/**
 * Claim one provider call for this Stripe event.
 *
 * A surviving pending state is intentionally not retried automatically. The
 * previous process might have reached Gmail and died before saving its result,
 * so another send could duplicate a sensitive payment notice. The pending row
 * tells an operator exactly which event needs manual confirmation.
 */
async function beginDelivery(input: {
  orgId: string;
  eventId: string;
  kind: BillingNotificationKind;
  recipient: string;
}): Promise<boolean> {
  const pending =
    "Delivery started but has not been confirmed. Check the platform Sent mailbox before retrying this billing notice.";
  const claimed = await query<{ id: string }>(
    `update stripe_events
        set org_id = coalesce(org_id, $2),
            notification_kind = $3,
            notification_status = 'pending',
            notification_recipient = $4,
            notification_error = $5,
            notification_started_at = now(),
            notification_finished_at = null
      where id = $1
        and notification_status is null
        and (org_id is null or org_id = $2)
      returning id`,
    [input.eventId, input.orgId, input.kind, input.recipient, pending]
  );
  if (claimed.length > 0) return true;

  const existing = await queryOne<{
    org_id: string | null;
    notification_status: "pending" | "sent" | "failed" | null;
  }>(
    `select org_id, notification_status
       from stripe_events
      where id = $1`,
    [input.eventId]
  );
  if (!existing) {
    throw new Error(`Stripe event ${input.eventId} no longer exists, so its notice was not sent.`);
  }
  if (existing.org_id && existing.org_id !== input.orgId) {
    throw new Error(
      `Stripe event ${input.eventId} belongs to a different organization, so its notice was not sent.`
    );
  }
  if (!existing.notification_status) {
    throw new Error(
      `Stripe event ${input.eventId} could not claim its billing notification, so nothing was sent.`
    );
  }

  if (existing.notification_status !== "sent") {
    const message =
      existing.notification_status === "pending"
        ? `The ${input.kind} billing notification has unconfirmed delivery. Check the platform Sent mailbox before retrying it.`
        : `The ${input.kind} billing notification previously failed. Check the Stripe event and platform inbox, then send the notice manually.`;
    await recordAttention({ ...input, message });
  }
  console.warn(
    `[billing-notify] ${input.eventId} already has notification state ${existing.notification_status}; no duplicate was sent.`
  );
  return false;
}

async function settleDelivery(input: {
  orgId: string;
  eventId: string;
  kind: BillingNotificationKind;
  status: "sent" | "failed";
  error: string | null;
  messageId: string | null;
}): Promise<boolean> {
  try {
    const rows = await query<{ id: string }>(
      `update stripe_events
          set notification_status = $2,
              notification_error = $3,
              notification_message_id = $4,
              notification_finished_at = now()
        where id = $1 and org_id = $5 and notification_status = 'pending'
        returning id`,
      [input.eventId, input.status, input.error, input.messageId, input.orgId]
    );
    if (rows.length === 0) {
      throw new Error("The pending notification row was not found.");
    }
    return true;
  } catch (error) {
    // The pre-send pending state is already durable. Do not throw after Gmail
    // may have accepted a message, because a webhook retry could send it twice.
    console.error(
      `[billing-notify] ${input.eventId} ${input.kind} result could not be saved; the durable state remains pending:`,
      error
    );
    return false;
  }
}

async function send(
  input: NotificationContext,
  kind: BillingNotificationKind,
  subject: string,
  lines: string[]
): Promise<void> {
  const to = await ownerEmail(input.orgId);
  if (!to?.email?.trim()) {
    await markNoRecipient(input, kind);
    return;
  }
  if (!(await beginDelivery({ ...input, kind, recipient: to.email }))) return;

  const greeting = to.name ? `Hi ${to.name},` : "Hi,";
  let result: Awaited<ReturnType<typeof systemMail.send>>;
  try {
    result = await systemMail.send({
      to: to.email,
      subject,
      text: [greeting, "", ...lines].join("\n"),
    });
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) };
  }

  const deliveryError = result.disabled
    ? result.error ?? "The platform billing inbox is not connected."
    : result.error ?? null;
  if (deliveryError) {
    await settleDelivery({
      ...input,
      kind,
      status: "failed",
      error: deliveryError.slice(0, 1000),
      messageId: null,
    });
    await recordAttention({
      ...input,
      kind,
      message: `The ${kind} billing notification was not sent. ${deliveryError} Check the platform inbox, then send the notice manually.`,
    });
    return;
  }

  if (!result.messageId) {
    await recordAttention({
      ...input,
      kind,
      message: `Gmail returned no error for the ${kind} billing notification, but it also returned no message id. Delivery is unconfirmed. Check the platform Sent mailbox before retrying it.`,
    });
    return;
  }

  const confirmed = await settleDelivery({
    ...input,
    kind,
    status: "sent",
    error: null,
    messageId: result.messageId ?? null,
  });
  if (!confirmed) {
    await recordAttention({
      ...input,
      kind,
      message: `Gmail accepted the ${kind} billing notification, but delivery confirmation could not be saved. Check the platform Sent mailbox before retrying it.`,
    });
  }
}

/** Trial started. States plainly what happens when it ends, and when. */
export async function notifyTrialStarted(input: {
  orgId: string;
  eventId: string;
  planName: string;
  amountCents: number | null;
  interval: string | null;
  trialEndsAt: string | null;
}): Promise<void> {
  const when = input.trialEndsAt
    ? new Date(input.trialEndsAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : "when your trial ends";
  const per = input.interval === "year" ? "per year" : "per month";
  await send(input, "trial-started", "Your Brost Co trial has started", [
    `Your ${input.planName} trial is live. Nothing is charged today.`,
    "",
    `On ${when} your card is charged ${money(input.amountCents)} ${per}, and then on the same date each ${input.interval === "year" ? "year" : "month"}.`,
    "",
    `Cancel any time before then and you will not be charged: ${billingUrl()}`,
  ]);
}

/** Trial is about to convert. Stripe fires this three days out. */
export async function notifyTrialEnding(input: {
  orgId: string;
  eventId: string;
  amountCents: number | null;
  interval: string | null;
  trialEndsAt: string | null;
}): Promise<void> {
  const when = input.trialEndsAt
    ? new Date(input.trialEndsAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : "shortly";
  const per = input.interval === "year" ? "per year" : "per month";
  await send(input, "trial-ending", "Your Brost Co trial ends soon", [
    `Your trial ends on ${when}. Your card will be charged ${money(input.amountCents)} ${per} to continue.`,
    "",
    `Nothing to do if you want to carry on. To change plan or cancel: ${billingUrl()}`,
  ]);
}

/** A payment succeeded. Points at Stripe's own invoice rather than rebuilding one. */
export async function notifyPaymentSucceeded(input: {
  orgId: string;
  eventId: string;
  amountCents: number | null;
  invoiceUrl: string | null;
  periodEnd: string | null;
}): Promise<void> {
  const next = input.periodEnd
    ? new Date(input.periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  await send(input, "payment-succeeded", "Your Brost Co payment went through", [
    `We received ${money(input.amountCents)}. Thank you.`,
    ...(next ? ["", `Your next renewal is ${next}.`] : []),
    ...(input.invoiceUrl ? ["", `Your invoice: ${input.invoiceUrl}`] : []),
  ]);
}

/**
 * A payment failed. The most important email here, so it says what happens
 * next rather than only that something went wrong.
 */
export async function notifyPaymentFailed(input: {
  orgId: string;
  eventId: string;
  amountCents: number | null;
  reason: string | null;
  nextAttemptAt: string | null;
  invoiceUrl: string | null;
}): Promise<void> {
  const retry = input.nextAttemptAt
    ? new Date(input.nextAttemptAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
      })
    : null;
  await send(input, "payment-failed", "Your Brost Co payment did not go through", [
    `We could not charge ${money(input.amountCents)}.${input.reason ? ` ${input.reason}` : ""}`,
    "",
    retry
      ? `We will try again on ${retry}. Updating your card before then avoids any interruption.`
      : "Please update your card to avoid an interruption.",
    "",
    `Update your payment method: ${billingUrl()}`,
    ...(input.invoiceUrl ? ["", `The invoice: ${input.invoiceUrl}`] : []),
  ]);
}

/** Subscription canceled. Says when access actually stops, which is what they want to know. */
export async function notifyCanceled(input: {
  orgId: string;
  eventId: string;
  endsAt: string | null;
  immediate: boolean;
}): Promise<void> {
  const when = input.endsAt
    ? new Date(input.endsAt).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  await send(input, "subscription-canceled", "Your Brost Co subscription is canceled", [
    input.immediate
      ? "Your subscription has been canceled and access has ended."
      : when
        ? `Your subscription is canceled. You keep full access until ${when}, and you will not be charged again.`
        : "Your subscription is canceled and you will not be charged again.",
    "",
    `Changed your mind? You can restart any time: ${billingUrl()}`,
  ]);
}

/** Subscription resumed after a cancellation that had not yet taken effect. */
export async function notifyReactivated(input: {
  orgId: string;
  eventId: string;
  periodEnd: string | null;
}): Promise<void> {
  const next = input.periodEnd
    ? new Date(input.periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  await send(
    input,
    "subscription-reactivated",
    "Your Brost Co subscription is active again",
    [
      "Your subscription has been restarted, so nothing is interrupted.",
      ...(next ? ["", `Your next renewal is ${next}.`] : []),
    ]
  );
}
