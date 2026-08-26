/**
 * What each role in an organization is allowed to do.
 *
 * Roles were being stored and never consulted. `organization_members.role`
 * has held owner / admin / operator / viewer since the multi-tenant migration,
 * the admin panel displays it, and two queries sort by it -- and that is the
 * entire extent of its use. Every signed-in member of an organization had
 * identical write access: a "read-only user" could change final pricing,
 * publish account-wide automation rules, delete subcontractors and submit a
 * federal bid. The word `viewer` appeared in the interface as a promise the
 * system did not keep.
 *
 * The model is capability-first rather than role-first. Code asks "may this
 * person submit a bid", never "is this person an admin", because the second
 * question has to be re-answered at every call site the day a role is added,
 * and the call sites are where it gets forgotten. Roles map to capabilities in
 * exactly one table, below.
 *
 * Deliberately NOT modelled: per-record ownership ("only the assigned
 * estimator may price this bid"). That is a real requirement for a larger team
 * and a bad fit for the accounts using this today, where two or three people
 * share everything and a lock would mostly lock out the person covering for
 * someone on leave. Assignment is tracked and shown; it does not gate.
 *
 * Pure.
 */

/**
 * The roles as they exist in the database, plus the two names the brief uses.
 *
 * `operator` is the stored value and `estimator` is what the people doing the
 * job call themselves, so both resolve to the same capabilities. Renaming the
 * column would have meant a migration whose only effect was vocabulary, and a
 * window where sessions carried a value the code no longer knew.
 */
export type OrgRole = "owner" | "admin" | "operator" | "estimator" | "member" | "viewer";

/**
 * The actions worth gating.
 *
 * One entry per decision a person could regret, and nothing for the ordinary
 * reading that makes up most of the day. A capability that never denies
 * anything is a check to maintain forever in exchange for nothing.
 */
export type Capability =
  /** Read anything inside the organization. Every role has this. */
  | "view"
  /** Pursue or pass an opportunity. */
  | "decide"
  /** Send outreach, log calls, reply to subcontractors. */
  | "outreach"
  /** Enter or change quoted and final pricing. */
  | "price"
  /** Submit a bid to the agency. The irreversible one. */
  | "submit"
  /** Add, edit, merge or archive subcontractor records. */
  | "manage_subs"
  /** Compliance items, renewals, evidence. */
  | "manage_compliance"
  /** Contracts, milestones, closeout. */
  | "manage_contracts"
  /** Publish automation rules. Account-wide, so it changes other people's work. */
  | "manage_rules"
  /** Email templates and reusable content. */
  | "manage_content"
  /** Connect, test or disconnect an integration. Touches credentials. */
  | "manage_integrations"
  /** The company profile: eligibility, targets, pricing posture. */
  | "manage_profile"
  /** Invite people, change their roles, remove them. */
  | "manage_team"
  /** Plan, payment method, cancellation. */
  | "manage_billing"
  /** Pause or resume all automation. */
  | "pause_automation"
  /** Run an agent by hand. */
  | "run_agents"
  /** Permanently delete a record. */
  | "delete_records";

/**
 * The matrix. The only place a role becomes a set of permissions.
 *
 * Read it as a ladder with one deliberate exception: an operator does the bid
 * work end to end, including submitting, but cannot change the settings that
 * govern how everyone's work behaves. That line is where the damage stops
 * being one bid and starts being the account.
 */
const MATRIX: Record<OrgRole, Capability[]> = {
  owner: [
    "view", "decide", "outreach", "price", "submit",
    "manage_subs", "manage_compliance", "manage_contracts",
    "manage_rules", "manage_content", "manage_integrations", "manage_profile",
    "manage_team", "manage_billing", "pause_automation", "run_agents", "delete_records",
  ],
  admin: [
    "view", "decide", "outreach", "price", "submit",
    "manage_subs", "manage_compliance", "manage_contracts",
    "manage_rules", "manage_content", "manage_integrations", "manage_profile",
    "manage_team", "pause_automation", "run_agents", "delete_records",
    // Not manage_billing: an administrator runs the account, the owner pays
    // for it, and those are different people often enough to matter.
  ],
  operator: [
    "view", "decide", "outreach", "price", "submit",
    "manage_subs", "manage_compliance", "manage_contracts",
    "run_agents",
  ],
  // Same job, the name the people doing it use.
  estimator: [
    "view", "decide", "outreach", "price", "submit",
    "manage_subs", "manage_compliance", "manage_contracts",
    "run_agents",
  ],
  member: [
    "view", "decide", "outreach",
    "manage_subs", "manage_compliance",
    // Not price or submit: a team member chases subcontractors and keeps
    // records straight. The two actions that commit money and commit the
    // company need someone who owns the number.
  ],
  viewer: ["view"],
};

/** How a role is named to the people it applies to. */
const LABELS: Record<OrgRole, string> = {
  owner: "Account owner",
  admin: "Administrator",
  operator: "Bid manager",
  estimator: "Bid manager",
  member: "Team member",
  viewer: "Read-only",
};

/** What the role is for, one line, for the team settings screen. */
const DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Everything, including billing and removing people.",
  admin: "Everything except billing.",
  operator: "Runs bids end to end: decisions, outreach, pricing and submission. Cannot change account settings.",
  estimator: "Runs bids end to end: decisions, outreach, pricing and submission. Cannot change account settings.",
  member: "Works opportunities and subcontractors. Cannot price or submit.",
  viewer: "Can read everything and change nothing.",
};

/**
 * An unrecognised role reads as the least privileged, never the most.
 *
 * A typo in a seed, a role added to the database before the code knows about
 * it, a hand-edited row: every one of those should fail closed. The cost of
 * being wrong this way is somebody asking to be let in; the cost of the other
 * way is a stranger submitting a bid.
 */
export function normalizeRole(role: string | null | undefined): OrgRole {
  const r = (role ?? "").trim().toLowerCase();
  return r in MATRIX ? (r as OrgRole) : "viewer";
}

export function can(role: string | null | undefined, capability: Capability): boolean {
  return MATRIX[normalizeRole(role)].includes(capability);
}

export function roleLabel(role: string | null | undefined): string {
  return LABELS[normalizeRole(role)];
}

export function roleDescription(role: string | null | undefined): string {
  return DESCRIPTIONS[normalizeRole(role)];
}

/** Every capability a role holds, for the team screen and for tests. */
export function capabilitiesOf(role: string | null | undefined): Capability[] {
  return [...MATRIX[normalizeRole(role)]];
}

/**
 * Which roles could do this, named for a permission message.
 *
 * "You do not have access" with no route forward reads as a broken product.
 * Naming who can help turns it into a two-minute conversation instead of a
 * support ticket.
 */
export function rolesWith(capability: Capability): string {
  const roles = (Object.keys(MATRIX) as OrgRole[])
    .filter((r) => r !== "estimator") // Same row as operator; naming both reads as two answers.
    .filter((r) => MATRIX[r].includes(capability))
    .map((r) => LABELS[r]);
  if (roles.length === 0) return "Nobody";
  if (roles.length === 1) return roles[0];
  return `${roles.slice(0, -1).join(", ")} or ${roles[roles.length - 1]}`.toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

/** What the action is called, so a refusal can name it. */
const CAPABILITY_LABELS: Record<Capability, string> = {
  view: "view this",
  decide: "pursue or pass opportunities",
  outreach: "contact subcontractors",
  price: "change pricing",
  submit: "submit bids",
  manage_subs: "change subcontractor records",
  manage_compliance: "change compliance items",
  manage_contracts: "change contracts",
  manage_rules: "change automation rules",
  manage_content: "change email templates",
  manage_integrations: "change integrations",
  manage_profile: "change the company profile",
  manage_team: "manage people and roles",
  manage_billing: "change billing",
  pause_automation: "pause or resume automation",
  run_agents: "run agents by hand",
  delete_records: "delete records",
};

export function capabilityLabel(capability: Capability): string {
  return CAPABILITY_LABELS[capability];
}

/**
 * Every capability, in the order a person would read them: the bid work
 * first, then the account-wide settings, then the destructive one.
 *
 * Exported so a screen can show what a role CANNOT do beside what it can.
 * Listing only the permissions somebody holds answers "what may I do" and
 * leaves "why can I not do this" to a refusal they meet later, which is the
 * expensive way to learn it.
 */
export const ALL_CAPABILITIES: Capability[] = [
  "view",
  "decide",
  "outreach",
  "price",
  "submit",
  "manage_subs",
  "manage_compliance",
  "manage_contracts",
  "run_agents",
  "pause_automation",
  "manage_rules",
  "manage_content",
  "manage_integrations",
  "manage_profile",
  "manage_team",
  "manage_billing",
  "delete_records",
];

/** The sentence shown when a control is unavailable. */
export function permissionMessage(role: string | null | undefined, capability: Capability): string {
  return (
    `Your role (${roleLabel(role).toLowerCase()}) cannot ${capabilityLabel(capability)}. ` +
    `${rolesWith(capability)} can, and can also change your role from Settings.`
  );
}
