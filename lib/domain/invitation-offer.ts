/**
 * What an invitation actually promises, in money, before it is sent.
 *
 * The builder collected a plan, a billing period and a discount, and showed
 * none of what any of that costs. So an administrator choosing twenty-five
 * per cent off a founding annual plan was doing the arithmetic in their head,
 * on a form whose output is a binding offer to a customer. The audit log
 * already carries a `invitation_terms_repaired` action for terms that were
 * agreed and never landed, which is the same failure discovered later and at
 * greater expense.
 *
 * Every figure here comes from the same catalog checkout prices from, and the
 * discount is applied by the same rules the concession code uses. A preview
 * computed a second way would be worse than no preview: it would be believed.
 */
import { PLANS, planPrice, ANNUAL_MONTHS_CHARGED } from "../billing/catalog";
import { describeConcession, type Concession } from "../billing/concessions";

/**
 * How long an invitation link stays good.
 *
 * Lives here rather than in lib/admin/invitations because this module is read
 * by the invitation builder, which is a client component: importing the admin
 * module would pull node:crypto, the database pool and the mail transport into
 * the browser bundle's module graph for the sake of one integer.
 */
export const INVITATION_DAYS = 14;

export interface OfferInput {
  plan: "standard" | "founding";
  interval: "month" | "year";
  concession: Concession;
  /** The role the invited person will hold. */
  role?: string;
  now?: Date;
}

export interface OfferLine {
  label: string;
  value: string;
  /** Set when the line needs a caveat rather than a number. */
  note?: string;
}

export interface OfferPreview {
  planName: string;
  periodLabel: string;
  /** What this plan costs without any concession. */
  normalPrice: string;
  /** The concession in words, or null when there is none. */
  discount: string | null;
  /** What the first invoice will actually be. */
  firstCharge: string;
  /** What it becomes afterwards, when that differs from the first charge. */
  laterCharge: string | null;
  /** When the invitation link stops working. */
  expiresOn: string;
  role: string;
  /** One sentence stating the whole offer, for the administrator to check. */
  summary: string;
  lines: OfferLine[];
}

function usd(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/**
 * The first invoice under a concession.
 *
 * Null means nothing is charged at all, which is a different thing from a
 * charge of zero dollars: a free account never has an invoice, and a free
 * month is an invoice that comes later. Collapsing them would tell somebody
 * their customer is billed nought on a plan that never bills.
 */
function firstAmount(base: number, c: Concession): number | null {
  switch (c.kind) {
    case "free_account":
      return null;
    case "free_months":
      return (c.months ?? 0) > 0 ? 0 : base;
    case "percent": {
      const pct = c.percent ?? 0;
      return Math.round(base * (1 - pct / 100));
    }
    default:
      return base;
  }
}

export function offerPreview(input: OfferInput): OfferPreview {
  const now = input.now ?? new Date();
  const price = planPrice(input.plan, input.interval);
  const plan = PLANS[input.plan];
  const c = input.concession;
  const role = input.role ?? "Owner";

  const periodLabel =
    input.interval === "year"
      ? `Annual, billed as ${ANNUAL_MONTHS_CHARGED} months`
      : "Monthly";
  const normal = usd(price.amountUsd);
  const first = firstAmount(price.amountUsd, c);

  const firstCharge =
    first == null
      ? "Nothing, ever"
      : first === 0
        ? `Nothing for the first ${c.months ?? 0} ${input.interval === "year" ? "years" : "months"}`
        : usd(first);

  // What it settles at. Only stated when it differs from the first charge,
  // because repeating the same number twice reads as two different facts.
  const laterCharge =
    c.kind === "free_account"
      ? null
      : c.kind === "free_months"
        ? `${normal} ${input.interval === "year" ? "a year" : "a month"} after that`
        : c.kind === "percent" && c.months
          ? `${normal} ${input.interval === "year" ? "a year" : "a month"} after ${c.months} ${c.months === 1 ? "month" : "months"}`
          : null;

  const expiry = new Date(now.getTime() + INVITATION_DAYS * 86_400_000);
  const expiresOn = expiry.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const discount = c.kind === "none" ? null : describeConcession(c);

  const summary =
    first == null
      ? `${plan.name}, free forever. Nothing is ever charged, and no card is asked for.`
      : first === 0
        ? `${plan.name}, ${periodLabel.toLowerCase()}. Nothing to pay at first, then ${normal}.`
        : first === price.amountUsd
          ? `${plan.name}, ${periodLabel.toLowerCase()}, at the normal ${normal}.`
          : `${plan.name}, ${periodLabel.toLowerCase()}. First charge ${usd(first)} instead of ${normal}.`;

  const lines: OfferLine[] = [
    { label: "Plan", value: plan.name, note: plan.grandfathered ? "Rate locked for the life of the subscription." : undefined },
    { label: "Billing period", value: periodLabel },
    { label: "Normal price", value: `${normal} ${input.interval === "year" ? "a year" : "a month"}` },
    {
      label: "Discount",
      value: discount ?? "None",
      note:
        c.kind === "free_account"
          ? // There is no checkout on this path at all, so saying the discount
            // is applied at one would describe a step that never happens.
            "No checkout and no card. The account is created with full access."
          : discount
            ? "Applied automatically at checkout, with no code to enter."
            : undefined,
    },
    { label: "First charge", value: firstCharge },
  ];
  if (laterCharge) lines.push({ label: "Then", value: laterCharge });
  lines.push(
    { label: "Role", value: role, note: "The first person in a new account owns it." },
    {
      label: "Link expires",
      value: expiresOn,
      note: `${INVITATION_DAYS} days from sending. It works once.`,
    }
  );

  return {
    planName: plan.name,
    periodLabel,
    normalPrice: normal,
    discount,
    firstCharge,
    laterCharge,
    expiresOn,
    role,
    summary,
    lines,
  };
}
