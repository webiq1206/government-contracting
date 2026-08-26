/**
 * What this account is actually told, by email, and what it is not.
 *
 * There was no surface for this, and the gap it hid is bigger than a missing
 * settings page. Billing messages are addressed to the account owner and work.
 * Every digest, though, is gated on the founding organization and on one
 * deployment-wide address, so a customer receives none of them: not the
 * compliance digest, not the weekly analytics, not the stalled-pipeline
 * warning. An operator whose subcontractor's insurance lapses on a live
 * contract gets no email about it and no way to find out from the interface
 * that no email was coming.
 *
 * So this module describes delivery honestly rather than offering switches for
 * messages that are not sent. A toggle that changes nothing is worse than no
 * toggle: it is a promise the product does not keep, and the operator only
 * discovers it the day the message they were relying on does not arrive.
 *
 * The audit also asks which critical notifications cannot be disabled and why.
 * That is a real category here: an account cannot switch off the message
 * telling it that its card was declined, because the consequence of silence is
 * losing access mid-bid.
 */

export type NotificationCategory =
  | "critical_account"
  | "deadlines"
  | "replies"
  | "assignments"
  | "automation_incidents"
  | "compliance"
  | "summaries"
  | "informational";

/** Where a category's messages actually go on this deployment. */
export type DeliveryRoute =
  | "account_owner" // emailed to the owner of this organization
  | "operations_address" // one address for the whole deployment, not this account
  | "in_app_only" // shown in the product, never emailed
  | "not_sent"; // nothing is produced at all

export interface CategoryDef {
  key: NotificationCategory;
  label: string;
  /** What it covers, in the operator's terms. */
  covers: string;
  /**
   * Whether an account may switch it off.
   *
   * False needs a reason, and the reason has to be about consequence rather
   * than about policy: "you cannot turn this off" is an instruction, "if you
   * miss this you lose access in the middle of a bid" is an explanation.
   */
  canDisable: boolean;
  whyMandatory?: string;
  /** Where in the product the same information appears, when it does. */
  inAppAt?: { label: string; href: string };
}

export const CATEGORIES: CategoryDef[] = [
  {
    key: "critical_account",
    label: "Critical account alerts",
    covers:
      "A payment that failed, a card that needs confirming, a trial about to end, a subscription cancelled or restored.",
    canDisable: false,
    whyMandatory:
      "Silence here costs access. A declined card that nobody sees becomes an account locked mid-bid, with a deadline that does not move.",
    inAppAt: { label: "Billing", href: "/settings/billing" },
  },
  {
    key: "automation_incidents",
    label: "Automation failures",
    covers:
      "The AI account running out of credit, a mailbox disconnecting, a sweep failing repeatedly.",
    canDisable: false,
    whyMandatory:
      "A stopped pipeline looks exactly like a quiet week from the inside. This is the only signal that distinguishes them before deadlines pass.",
    inAppAt: { label: "Automation Health", href: "/agents" },
  },
  {
    key: "deadlines",
    label: "Deadlines",
    covers: "Bids approaching their submission date, and quotes due back from subcontractors.",
    canDisable: true,
    inAppAt: { label: "Today", href: "/today" },
  },
  {
    key: "replies",
    label: "Subcontractor replies",
    covers: "A subcontractor writing back with a price, a question, or a decline.",
    canDisable: true,
    inAppAt: { label: "Communications", href: "/communications" },
  },
  {
    key: "assignments",
    label: "Work assigned to you",
    covers: "Anything handed to a particular person rather than to the account.",
    canDisable: true,
  },
  {
    key: "compliance",
    label: "Compliance reminders",
    covers:
      "Registrations and certifications expiring, and subcontractor insurance lapsing, including on live contracts.",
    canDisable: true,
    inAppAt: { label: "Compliance", href: "/compliance" },
  },
  {
    key: "summaries",
    label: "Periodic summaries",
    covers: "The weekly performance digest and scoring-weight proposals.",
    canDisable: true,
    inAppAt: { label: "Analytics", href: "/analytics" },
  },
  {
    key: "informational",
    label: "Product updates",
    covers: "Changes to how the platform works, and new capabilities.",
    canDisable: true,
  },
];

export interface CategoryStatus extends CategoryDef {
  route: DeliveryRoute;
  /** Whether email for this category reaches this account at all. */
  reachesAccount: boolean;
  /**
   * A category that cannot be switched off and also is not being delivered.
   *
   * The most dangerous state on this page, and the easiest to render as
   * reassurance: "always on" beside "no email is sent" reads as a promise
   * where it is in fact a gap. An account is relying on an alert that will not
   * arrive, and only this flag distinguishes that from an alert that is simply
   * optional and switched off.
   */
  deliveryGap: boolean;
  /** What is true today, stated plainly. */
  statement: string;
}

export interface DeliveryFacts {
  /** True for the organization the deployment's digests are addressed about. */
  isOperationsOrg: boolean;
  /** Whether a deployment-wide digest address is configured at all. */
  hasOperationsAddress: boolean;
  /** Whether outbound system mail can be sent at all. */
  mailEnabled: boolean;
  /** The address account-level mail is sent to, when there is one. */
  ownerEmail: string | null;
}

/**
 * Which categories are emailed to this account, and which are not.
 *
 * `assignments` is `not_sent` rather than `in_app_only` on purpose: there is no
 * assignee anywhere in the schema, so nothing produces these messages. Calling
 * that "in app" would imply the information exists somewhere, and it does not.
 */
export function categoryStatuses(facts: DeliveryFacts): CategoryStatus[] {
  return CATEGORIES.map((def) => {
    let route: DeliveryRoute;
    if (def.key === "critical_account") {
      route = facts.mailEnabled && facts.ownerEmail ? "account_owner" : "in_app_only";
    } else if (def.key === "assignments" || def.key === "informational") {
      route = "not_sent";
    } else if (def.key === "automation_incidents") {
      route = "in_app_only";
    } else {
      // Digests. Sent only for the operations organization, and only to the
      // deployment's own address.
      route =
        facts.isOperationsOrg && facts.hasOperationsAddress && facts.mailEnabled
          ? "operations_address"
          : "in_app_only";
    }
    return {
      ...def,
      route,
      reachesAccount: route === "account_owner",
      deliveryGap: !def.canDisable && route !== "account_owner",
      statement: statementFor(def, route, facts),
    };
  });
}

function statementFor(
  def: CategoryDef,
  route: DeliveryRoute,
  facts: DeliveryFacts
): string {
  switch (route) {
    case "account_owner":
      return `Emailed to ${facts.ownerEmail ?? "the account owner"}.`;
    case "operations_address":
      return "Emailed to this deployment's operations address, not to the account.";
    case "not_sent":
      return def.key === "assignments"
        ? "Nothing produces these. There is no way to assign work to a person yet, so there is nothing to notify anybody about."
        : "Not sent. Product updates are announced in the release notes rather than by email.";
    case "in_app_only":
    default:
      return def.inAppAt
        ? `No email. This appears in ${def.inAppAt.label} and nowhere else, so it is only seen by somebody who opens the page.`
        : "No email is sent for this.";
  }
}

/**
 * The one sentence somebody should read before relying on any of this.
 *
 * It names the specific risk rather than describing the mechanism, because
 * "digests are not configured per account" is a fact about the code and
 * "nobody will email you when a subcontractor's insurance lapses" is a fact
 * about the operator's week.
 */
export function deliverySummary(statuses: CategoryStatus[]): string {
  const emailed = statuses.filter((s) => s.reachesAccount);
  const silent = statuses.filter((s) => s.route === "in_app_only" && s.inAppAt);
  if (emailed.length === 0) {
    return "This account receives no email from the platform at all. Everything below is visible only to somebody who opens the page it lives on.";
  }
  if (silent.length === 0) {
    return `Emailed to ${emailed[0].statement.replace(/^Emailed to /, "").replace(/\.$/, "")}.`;
  }
  return `Only critical account alerts are emailed to this account. ${silent.length} other kinds of alert, including ${silent
    .slice(0, 3)
    .map((s) => s.label.toLowerCase())
    .join(", ")}, appear in the product and are never sent anywhere, so nobody is told about them unless they look.`;
}
