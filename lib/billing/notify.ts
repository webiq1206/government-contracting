/**
 * Billing emails to the customer.
 *
 * Sent through the platform inbox, never a tenant's: these are messages from
 * us about their account, and a customer whose card just failed may have no
 * working connection of their own.
 *
 * Every function is best-effort. A notification that fails to send must never
 * fail the webhook, because Stripe would retry it and the subscription state
 * would be reapplied for the sake of an email.
 */
import { systemMail } from "../integrations/system-mail";
import { queryOne } from "../db";
import { config } from "../config";

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
  ).catch(() => null);
}

async function send(orgId: string, subject: string, lines: string[]): Promise<void> {
  const to = await ownerEmail(orgId);
  if (!to?.email) return;
  const greeting = to.name ? `Hi ${to.name},` : "Hi,";
  await systemMail
    .send({ to: to.email, subject, text: [greeting, "", ...lines].join("\n") })
    .catch(() => undefined);
}

/** Trial started. States plainly what happens when it ends, and when. */
export async function notifyTrialStarted(input: {
  orgId: string;
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
  await send(input.orgId, "Your Brost Co trial has started", [
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
  await send(input.orgId, "Your Brost Co trial ends soon", [
    `Your trial ends on ${when}. Your card will be charged ${money(input.amountCents)} ${per} to continue.`,
    "",
    `Nothing to do if you want to carry on. To change plan or cancel: ${billingUrl()}`,
  ]);
}

/** A payment succeeded. Points at Stripe's own invoice rather than rebuilding one. */
export async function notifyPaymentSucceeded(input: {
  orgId: string;
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
  await send(input.orgId, "Your Brost Co payment went through", [
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
  await send(input.orgId, "Your Brost Co payment did not go through", [
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
  await send(input.orgId, "Your Brost Co subscription is canceled", [
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
  periodEnd: string | null;
}): Promise<void> {
  const next = input.periodEnd
    ? new Date(input.periodEnd).toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;
  await send(input.orgId, "Your Brost Co subscription is active again", [
    "Your subscription has been restarted, so nothing is interrupted.",
    ...(next ? ["", `Your next renewal is ${next}.`] : []),
  ]);
}
