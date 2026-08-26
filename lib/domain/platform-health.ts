/**
 * Whether the platform is working, as distinct from whether one account is.
 *
 * Automation Health answers the second question, per tenant, and answers it
 * well. Nothing answered the first. So an outage affecting every customer had
 * to be discovered one organization at a time, by an administrator who
 * happened to open the right account, which means the platform's own worst
 * failures were the ones it was slowest to notice.
 *
 * The services named here are the audit's, and each one is defined by the
 * agents that actually perform it rather than by a hand-maintained status
 * flag. A flag has to be remembered; a run either happened or it did not.
 *
 * The rule that matters throughout: silence is not health. A service whose
 * agents have not run at all is `unknown`, never `healthy`, because the two
 * look identical from a table of failures and only one of them is fine.
 */
import { classifyFailure, type IncidentCause } from "./automation-health";

export type ServiceKey =
  | "ingestion"
  | "scoring"
  | "email_delivery"
  | "inbox_sync"
  | "documents"
  | "scheduled_automation"
  | "provider_capacity"
  | "billing_webhooks"
  | "queues";

export interface ServiceDef {
  key: ServiceKey;
  label: string;
  /** What stops working for customers when this does. */
  impact: string;
  /** Agent names whose runs stand for this service, when it is agent-driven. */
  agents: string[];
}

export const SERVICES: ServiceDef[] = [
  {
    key: "ingestion",
    label: "Opportunity ingestion",
    impact: "No new opportunities reach any account. Existing work is unaffected, and deadlines keep moving.",
    agents: ["opportunity-monitor"],
  },
  {
    key: "scoring",
    label: "Scoring and analysis",
    impact: "Opportunities arrive and pile up unscored, so nothing is recommended and nothing auto-pursues.",
    agents: ["scoring-engine", "solicitation-analyst", "scoring-recovery-sweep"],
  },
  {
    key: "email_delivery",
    label: "Email delivery",
    impact: "Outreach and follow-ups are not reaching subcontractors, so quotes stop arriving.",
    agents: ["outreach", "outreach-followup", "outreach-recovery-sweep"],
  },
  {
    key: "inbox_sync",
    label: "Inbox sync",
    impact: "Replies are not being read, so quotes sit unseen and subcontractors get chased after answering.",
    agents: ["reply-poll"],
  },
  {
    key: "documents",
    label: "Document processing",
    impact: "Bid packages cannot be assembled or validated, so submissions stop at the last step.",
    agents: ["bid-builder", "package-builder", "compliance-auditor"],
  },
  {
    key: "scheduled_automation",
    label: "Scheduled automation",
    impact: "The sweeps that expire, chase and tidy are not running, so stale work accumulates quietly.",
    agents: [
      "deadline-monitor",
      "review-expiry-sweep",
      "expired-opportunity-sweep",
      "stalled-pipeline-sweep",
      "unresponsive-sweep",
      "compliance-sweep",
      "retention-sweep",
      "account-deletion-sweep",
    ],
  },
  {
    key: "provider_capacity",
    label: "AI provider capacity",
    impact: "Every agent that needs the model fails, which is most of them.",
    agents: [],
  },
  {
    key: "billing_webhooks",
    label: "Billing webhooks",
    impact: "Renewals, failures and cancellations are not being recorded, so access and revenue drift from reality.",
    agents: [],
  },
  {
    key: "queues",
    label: "Background queues",
    impact: "Work is accepted and never picked up, which looks like nothing happening rather than like a failure.",
    agents: [],
  },
];

export type ServiceState = "healthy" | "degraded" | "down" | "unknown";

export interface AgentRunFacts {
  agent: string;
  /** Runs in the window, across every organization. */
  runs: number;
  errors: number;
  lastRunAt: string | null;
  lastErrorAt: string | null;
  /** One representative error, for grouping by cause. */
  sampleError: string | null;
  /** How many distinct organizations saw a failure from this agent. */
  affectedOrgs: number;
}

export interface ServiceStatus extends ServiceDef {
  state: ServiceState;
  runs: number;
  errors: number;
  /** Null when no run happened, so a rate is never nought over nothing. */
  failureRate: number | null;
  lastRunAt: string | null;
  /** Organizations that saw at least one failure from this service. */
  affectedOrgs: number;
  detail: string;
  /**
   * What to call this state on this card, when "Not run" would be wrong.
   *
   * The unknown state means the same thing everywhere (no evidence), but it
   * arrives differently: an agent-driven service has not run, while a queue
   * simply cannot be measured on this deployment. One badge word for both
   * would tell an administrator the queue had stopped.
   */
  stateWord?: string;
}

/** Every run failing is down; some failing is degraded. */
const DOWN_RATE = 0.9;
const DEGRADED_RATE = 0.2;
/** Below this, a rate is noise rather than a signal. */
const MIN_RUNS = 3;

function stateFor(runs: number, errors: number): ServiceState {
  if (runs === 0) return "unknown";
  const rate = errors / runs;
  if (runs >= MIN_RUNS && rate >= DOWN_RATE) return "down";
  if (errors > 0 && (rate >= DEGRADED_RATE || runs < MIN_RUNS)) return "degraded";
  if (errors > 0) return "degraded";
  return "healthy";
}

export function serviceStatuses(
  facts: AgentRunFacts[],
  extras: {
    /** Billing webhook health, computed elsewhere from the events table. */
    billingWebhooks: { state: ServiceState; detail: string };
    /** Provider capacity, from the failures already classified. */
    providerCapacity: { state: ServiceState; detail: string };
    /** Queue depth, or null when this deployment cannot measure it. */
    queueDepth: number | null;
  }
): ServiceStatus[] {
  const byAgent = new Map(facts.map((f) => [f.agent, f]));
  return SERVICES.map((def) => {
    if (def.key === "billing_webhooks") {
      return {
        ...def,
        ...extras.billingWebhooks,
        runs: 0,
        errors: 0,
        failureRate: null,
        lastRunAt: null,
        affectedOrgs: 0,
      };
    }
    if (def.key === "provider_capacity") {
      return {
        ...def,
        ...extras.providerCapacity,
        runs: 0,
        errors: 0,
        failureRate: null,
        lastRunAt: null,
        affectedOrgs: 0,
      };
    }
    if (def.key === "queues") {
      const depth = extras.queueDepth;
      return {
        ...def,
        state: depth == null ? "unknown" : depth > 500 ? "degraded" : "healthy",
        stateWord: depth == null ? "Not measured" : undefined,
        detail:
          depth == null
            ? "Queue depth is not measurable on this deployment, so a growing backlog would not be visible here."
            : depth > 500
              ? `${depth} jobs waiting. Work is arriving faster than it is cleared.`
              : `${depth} jobs waiting.`,
        runs: 0,
        errors: 0,
        failureRate: null,
        lastRunAt: null,
        affectedOrgs: 0,
      };
    }

    let runs = 0;
    let errors = 0;
    let lastRunAt: string | null = null;
    let affectedOrgs = 0;
    for (const name of def.agents) {
      const f = byAgent.get(name);
      if (!f) continue;
      runs += f.runs;
      errors += f.errors;
      affectedOrgs = Math.max(affectedOrgs, f.affectedOrgs);
      if (f.lastRunAt && (!lastRunAt || f.lastRunAt > lastRunAt)) lastRunAt = f.lastRunAt;
    }
    const state = stateFor(runs, errors);
    return {
      ...def,
      state,
      runs,
      errors,
      // Never nought over nothing: a service that has not run has no rate.
      failureRate: runs > 0 ? Math.round((errors / runs) * 1000) / 10 : null,
      lastRunAt,
      affectedOrgs,
      detail:
        runs === 0
          ? "Nothing has run in this window, so there is no evidence either way. That is expected on a quiet deployment and a warning on a busy one."
          : errors === 0
            ? `${runs} run${runs === 1 ? "" : "s"}, none failed.`
            : `${errors} of ${runs} run${runs === 1 ? "" : "s"} failed${affectedOrgs > 0 ? `, across ${affectedOrgs} account${affectedOrgs === 1 ? "" : "s"}` : ""}.`,
    };
  });
}

// ---------------------------------------------------------------------------
// Overall
// ---------------------------------------------------------------------------

export type PlatformState = "operational" | "degraded" | "major_outage" | "unknown";

export interface PlatformStatus {
  state: PlatformState;
  headline: string;
  detail: string;
  /** Services in each state, so the headline can be checked against the list. */
  down: ServiceKey[];
  degraded: ServiceKey[];
  unknown: ServiceKey[];
}

export function platformStatus(services: ServiceStatus[]): PlatformStatus {
  const down = services.filter((s) => s.state === "down").map((s) => s.key);
  const degraded = services.filter((s) => s.state === "degraded").map((s) => s.key);
  const unknown = services.filter((s) => s.state === "unknown").map((s) => s.key);
  const name = (k: ServiceKey) => SERVICES.find((s) => s.key === k)?.label ?? k;

  if (down.length > 0) {
    return {
      state: "major_outage",
      headline:
        down.length === 1
          ? `${name(down[0])} is down`
          : `${down.length} services are down`,
      detail: `Every account is affected: ${down.map(name).join(", ")}. Fix this before anything else on this page.`,
      down,
      degraded,
      unknown,
    };
  }
  if (degraded.length > 0) {
    return {
      state: "degraded",
      headline: `${degraded.length} service${degraded.length === 1 ? "" : "s"} degraded`,
      detail: `Work is still moving, with failures: ${degraded.map(name).join(", ")}.`,
      down,
      degraded,
      unknown,
    };
  }
  // Everything quiet is not the same as everything working, and this is the
  // exact place that distinction is worth money: a platform whose agents have
  // all stopped shows no failures at all.
  if (unknown.length === services.length) {
    return {
      state: "unknown",
      headline: "Nothing has run",
      detail:
        "No agent has run in this window on any account, so nothing here can be called healthy. Either the deployment is idle or the worker is not running.",
      down,
      degraded,
      unknown,
    };
  }
  return {
    state: "operational",
    headline: "Operating normally",
    detail:
      unknown.length > 0
        ? `No failures anywhere. ${unknown.length} service${unknown.length === 1 ? " has" : "s have"} not run in this window, so ${unknown.length === 1 ? "it is" : "they are"} unproven rather than healthy.`
        : "Every service has run and none has failed.",
    down,
    degraded,
    unknown,
  };
}

// ---------------------------------------------------------------------------
// Incidents, grouped across every tenant
// ---------------------------------------------------------------------------

export interface PlatformIncident {
  cause: IncidentCause;
  /** Failures across every organization in the window. */
  failures: number;
  /** Distinct organizations that saw it. */
  orgs: number;
  agents: string[];
  firstSeen: string;
  lastSeen: string;
  sample: string;
  /** True when this cause stops work rather than slowing it. */
  blocking: boolean;
}

export interface FailureRow {
  agent: string;
  orgId: string | null;
  error: string | null;
  at: string;
}

const BLOCKING: IncidentCause[] = [
  "provider_credit",
  "provider_auth",
  "queue_unreachable",
  "database",
];

/**
 * One incident per root cause, whatever the tenant.
 *
 * Grouping per organization would report the same exhausted credit balance
 * once for every customer it stopped, which is the wrong shape for a page
 * whose reader fixes it once. The organization count is what turns a cause
 * into a priority.
 */
export function platformIncidents(rows: FailureRow[]): PlatformIncident[] {
  const byCause = new Map<IncidentCause, PlatformIncident & { orgSet: Set<string> }>();
  for (const r of rows) {
    const cause = classifyFailure(r.error);
    const existing = byCause.get(cause);
    if (existing) {
      existing.failures += 1;
      if (!existing.agents.includes(r.agent)) existing.agents.push(r.agent);
      if (r.orgId) existing.orgSet.add(r.orgId);
      if (r.at < existing.firstSeen) existing.firstSeen = r.at;
      if (r.at > existing.lastSeen) existing.lastSeen = r.at;
    } else {
      byCause.set(cause, {
        cause,
        failures: 1,
        orgs: 0,
        agents: [r.agent],
        firstSeen: r.at,
        lastSeen: r.at,
        sample: r.error ?? "",
        blocking: BLOCKING.includes(cause),
        orgSet: new Set(r.orgId ? [r.orgId] : []),
      });
    }
  }
  return [...byCause.values()]
    .map(({ orgSet, ...rest }) => ({ ...rest, orgs: orgSet.size }))
    .sort(
      (a, b) =>
        Number(b.blocking) - Number(a.blocking) || b.orgs - a.orgs || b.failures - a.failures
    );
}

/** How fresh this page is, said as a time rather than implied by being on screen. */
export function refreshedLabel(at: Date): string {
  return at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}
