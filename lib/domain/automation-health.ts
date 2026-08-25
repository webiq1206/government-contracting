/**
 * One answer to "is the automation working?", for every surface that asks.
 *
 * There were two, and they contradicted each other in public. The sidebar
 * computed its own answer from the worker's heartbeat -- "has the process
 * checked in recently" -- and printed "Running normally" whenever it had. The
 * Automation Log, on the same account at the same moment, listed page after
 * page of failed runs because the Anthropic account was out of credit. Both
 * were reporting honestly about different things. Together they told the
 * operator the machine was fine while nothing was being scored, analysed or
 * drafted, which is the single most expensive lie this product can tell:
 * everything looks handled, so nobody handles it, and the deadlines pass.
 *
 * The fix is not a better heartbeat. It is admitting that "the process is
 * alive" and "the work is getting done" are different questions, and that the
 * operator only ever cared about the second one. A worker that is beating
 * steadily while every job it picks up fails is not healthy. It is blocked,
 * and blocked is worse than down, because down is obvious.
 *
 * So this module takes both kinds of fact -- liveness AND outcomes -- and
 * returns one state that every surface renders. Five states, chosen because
 * they are the five different things an operator would DO:
 *
 *   healthy         nothing to do
 *   degraded        something is failing, but work is still moving; look soon
 *   blocked         work has stopped; fix this now or deadlines pass
 *   paused          a human turned it off; turn it back on when ready
 *   not_configured  it was never set up; finish setup to start
 *
 * `paused` and `not_configured` are deliberately not failures. Reporting a
 * deliberate pause as an incident trains people to ignore incidents, and
 * reporting an unfinished setup as a fault sends a new customer looking for a
 * bug in something that is simply waiting for them.
 *
 * Pure. The caller gathers the facts; this decides what they add up to.
 */

export type AutomationState = "healthy" | "degraded" | "blocked" | "paused" | "not_configured";

/**
 * Why something is failing, at the level a repair is chosen.
 *
 * Deliberately coarse. Forty stack traces that all say "credit balance too
 * low" are one problem with one fix, and listing them forty times buries the
 * other two problems that also need attention. The cause is what gets grouped
 * on, so it has to be the thing a person would act on, not the thing the
 * exception happened to say.
 */
export type IncidentCause =
  | "provider_credit"
  | "provider_auth"
  | "provider_rate_limit"
  | "provider_unavailable"
  | "integration_auth"
  | "queue_unreachable"
  | "database"
  | "network"
  | "not_configured"
  | "unknown";

export interface IncidentSpec {
  /** Plain language, no stack trace, no provider jargon. */
  title: string;
  /** What stops working while this is true, in the operator's terms. */
  effect: string;
  /** The exact thing to do. One action, not a list of possibilities. */
  repair: string;
  /** Where to go and do it, when there is somewhere. */
  repairHref?: string;
  /**
   * Whether work stops entirely. A blocking cause outranks any number of
   * non-blocking ones: one exhausted credit balance matters more than fifty
   * timeouts that retried successfully.
   */
  blocking: boolean;
}

const CAUSES: Record<IncidentCause, IncidentSpec> = {
  provider_credit: {
    title: "The AI account is out of credit",
    effect:
      "Nothing is being scored, analysed, drafted or read. Opportunities keep arriving and keep piling up unprocessed.",
    repair: "Add credit to the Anthropic account at console.anthropic.com under Billing.",
    repairHref: "/settings/integrations",
    blocking: true,
  },
  provider_auth: {
    title: "The AI key was rejected",
    effect:
      "Nothing is being scored, analysed, drafted or read. The key was deleted, revoked, or pasted incompletely.",
    repair: "Create a new key at console.anthropic.com and save it under Settings, Integrations.",
    repairHref: "/settings/integrations",
    blocking: true,
  },
  provider_rate_limit: {
    title: "The AI account is being rate limited",
    effect: "Work is running slower than usual and some jobs are being retried.",
    repair: "This usually clears itself. If it lasts more than an hour, ask Anthropic to raise the account limits.",
    blocking: false,
  },
  provider_unavailable: {
    title: "The AI service is returning errors",
    effect: "Some jobs are failing and will be retried. This is on the provider's side.",
    repair: "No action needed yet. Retries continue automatically.",
    blocking: false,
  },
  integration_auth: {
    title: "A connected account needs reconnecting",
    effect: "Email cannot be sent or read, so outreach and replies have stopped moving.",
    repair: "Reconnect the mailbox under Settings, Integrations.",
    repairHref: "/settings/integrations",
    blocking: true,
  },
  queue_unreachable: {
    title: "The job queue cannot be reached",
    effect: "No automated work can start. Anything already queued is waiting.",
    repair: "The worker is retrying. If this lasts more than a few minutes, restart the deployment.",
    blocking: true,
  },
  database: {
    title: "The database is refusing connections",
    effect: "Automated work cannot read or write. The application itself may be affected.",
    repair: "Check the database is running and that its connection limit has not been exhausted.",
    blocking: true,
  },
  network: {
    title: "Outbound network calls are failing",
    effect: "Jobs that reach outside the deployment are failing and will be retried.",
    repair: "Check the deployment's outbound access if this persists.",
    blocking: false,
  },
  not_configured: {
    title: "Automation has not been set up",
    effect: "Nothing runs automatically yet.",
    repair: "Finish setup under Settings, Integrations.",
    repairHref: "/settings/integrations",
    blocking: false,
  },
  unknown: {
    title: "Jobs are failing for an unrecognised reason",
    effect: "Some automated work is not completing.",
    repair: "Open the incident for the underlying error, and send it to support if it is not obvious.",
    blocking: false,
  },
};

export function causeSpec(cause: IncidentCause): IncidentSpec {
  return CAUSES[cause];
}

/**
 * Read a root cause out of an error message.
 *
 * Order matters and is not alphabetical. Credit is tested before the generic
 * billing words because "insufficient credit balance" also contains "balance";
 * auth is tested before rate limiting because a revoked key can come back as a
 * 429 on some paths. Each branch is the narrowest phrase that identifies the
 * cause uniquely.
 */
export function classifyFailure(error: string | null | undefined): IncidentCause {
  const text = (error ?? "").toLowerCase();
  if (!text.trim()) return "unknown";
  if (/credit balance|insufficient (?:credit|funds)|too low|add credit/.test(text)) return "provider_credit";
  if (/api key|unauthori[sz]ed|invalid key|revoked|401|403/.test(text)) return "provider_auth";
  if (/rate limit|429|too many requests/.test(text)) return "provider_rate_limit";
  if (/reconnect|token expired|invalid_grant|refresh token|gmail/.test(text)) return "integration_auth";
  if (/queue|pg-?boss|unreachable/.test(text)) return "queue_unreachable";
  if (/econnrefused.*5432|database|relation .* does not exist|too many connections/.test(text))
    return "database";
  if (/5\d\d|server error|overloaded|service unavailable/.test(text)) return "provider_unavailable";
  if (/fetch failed|enotfound|etimedout|network|timeout|aborted/.test(text)) return "network";
  if (/not configured|missing key|no api key/.test(text)) return "not_configured";
  return "unknown";
}

/** One run of one agent, as the health model needs to see it. */
export interface RunFact {
  agent: string;
  /** The agent's display name, for naming affected workflows. */
  label?: string;
  status: "ok" | "error" | "running" | string;
  startedAt: string | Date;
  error?: string | null;
}

export interface HealthInput {
  /** The master switch. A deliberate stop, not a fault. */
  paused: boolean;
  /** The worker's own check-in, when it has written one. */
  heartbeatAt?: string | Date | null;
  /** What the worker says it is doing: "ready", "queue-unreachable", ... */
  phase?: string | null;
  /** Runs in the recent window, newest first or not, order does not matter. */
  runs: RunFact[];
  /**
   * Jobs waiting to be picked up, or null when the queue backend cannot be
   * counted. Null rather than zero on purpose: "we do not know" and "there is
   * nothing waiting" are different facts, and showing an unknown as zero is
   * how a growing backlog stays invisible.
   */
  backlog?: number | null;
  /**
   * Whether the account has the credentials automation needs at all. False
   * means "never set up", which is a setup step and not a failure.
   */
  configured?: boolean;
  /** Opportunities held up by the failures, when the caller can count them. */
  affectedOpportunities?: number;
  now?: Date;
}

export interface Incident {
  cause: IncidentCause;
  spec: IncidentSpec;
  /** How many runs failed this way in the window. */
  failures: number;
  /** Which agents hit it, by display label where known. */
  affectedWorkflows: string[];
  firstSeen: string;
  lastSeen: string;
  /** One representative error, kept for the "Technical details" disclosure. */
  sample: string;
}

export interface AutomationHealth {
  state: AutomationState;
  /** Six words for a sidebar. Never "Running normally" unless it is true. */
  headline: string;
  /** One sentence with the reason, for a banner or a tooltip. */
  detail: string;
  /** Grouped by root cause, worst first. */
  incidents: Incident[];
  lastSuccessAt: string | null;
  backlog: number | null;
  affectedOpportunities: number;
  failureRate: number;
  /** True when a banner should interrupt the operator rather than wait. */
  interrupt: boolean;
}

/** The worker is considered alive if it checked in within this window. */
const HEARTBEAT_STALE_MS = 5 * 60_000;
/** Below this many runs, a failure rate is noise rather than a signal. */
const MIN_RUNS_FOR_RATE = 4;
/** A backlog this deep means work is arriving faster than it is cleared. */
const BACKLOG_ALARM = 50;

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export function assessAutomation(input: HealthInput): AutomationHealth {
  const now = input.now ?? new Date();
  const runs = input.runs ?? [];
  const failures = runs.filter((r) => r.status === "error");
  const successes = runs.filter((r) => r.status === "ok");
  const backlog = input.backlog == null ? null : Math.max(0, input.backlog);
  const affectedOpportunities = Math.max(0, input.affectedOpportunities ?? 0);

  const lastSuccessAt =
    successes
      .map((r) => iso(r.startedAt))
      .sort()
      .pop() ?? null;

  const failureRate = runs.length >= MIN_RUNS_FOR_RATE ? failures.length / runs.length : 0;

  // Group by cause rather than by agent. Five agents failing on one exhausted
  // credit balance is one problem with one fix, and showing it five times is
  // how a page full of red trains someone to stop reading it.
  const byCause = new Map<IncidentCause, Incident>();
  for (const run of failures) {
    const cause = classifyFailure(run.error);
    const at = iso(run.startedAt);
    const existing = byCause.get(cause);
    const workflow = run.label ?? run.agent;
    if (existing) {
      existing.failures += 1;
      if (!existing.affectedWorkflows.includes(workflow)) existing.affectedWorkflows.push(workflow);
      if (at < existing.firstSeen) existing.firstSeen = at;
      if (at > existing.lastSeen) existing.lastSeen = at;
      if (!existing.sample && run.error) existing.sample = run.error;
    } else {
      byCause.set(cause, {
        cause,
        spec: CAUSES[cause],
        failures: 1,
        affectedWorkflows: [workflow],
        firstSeen: at,
        lastSeen: at,
        sample: run.error ?? "",
      });
    }
  }

  // The queue being unreachable is a fact the worker reports about itself; it
  // does not need a failed run to prove it, and by definition there will not
  // be one, because no job can start.
  if (input.phase === "queue-unreachable" && !byCause.has("queue_unreachable")) {
    byCause.set("queue_unreachable", {
      cause: "queue_unreachable",
      spec: CAUSES.queue_unreachable,
      failures: 0,
      affectedWorkflows: [],
      firstSeen: now.toISOString(),
      lastSeen: now.toISOString(),
      sample: `worker phase: ${input.phase}`,
    });
  }

  const incidents = [...byCause.values()].sort((a, b) => {
    if (a.spec.blocking !== b.spec.blocking) return a.spec.blocking ? -1 : 1;
    return b.failures - a.failures;
  });

  const blocking = incidents.filter((i) => i.spec.blocking);
  const beating =
    input.heartbeatAt != null && now.getTime() - new Date(input.heartbeatAt).getTime() < HEARTBEAT_STALE_MS;

  const base = {
    incidents,
    lastSuccessAt,
    backlog,
    affectedOpportunities,
    failureRate,
  };

  // Order below is the order of precedence, and each step is a claim about
  // what the operator most needs to know.

  // A deliberate stop is not a fault, and saying so first stops the paused
  // state from being buried under the failures that pausing itself caused.
  if (input.paused) {
    return {
      ...base,
      state: "paused",
      headline: "Automation is paused",
      detail:
        "Someone turned automation off. Nothing runs, nothing is sent, and nothing is scored until it is turned back on.",
      interrupt: false,
    };
  }

  // Never set up is a setup step, not a failure. A new account seeing "blocked"
  // goes looking for something broken.
  if (input.configured === false) {
    return {
      ...base,
      state: "not_configured",
      headline: "Automation is not set up",
      detail:
        "Automation has not been connected yet, so nothing runs on its own. Finishing setup under Settings, Integrations starts it.",
      interrupt: false,
    };
  }

  if (blocking.length > 0) {
    const worst = blocking[0];
    return {
      ...base,
      state: "blocked",
      headline: "Automation is blocked",
      detail: `${worst.spec.title}. ${worst.spec.effect}`,
      interrupt: true,
    };
  }

  // A silent worker is blocked whether or not anything has failed: no failures
  // is what "nothing is running at all" looks like from the job log.
  if (input.heartbeatAt != null && !beating) {
    return {
      ...base,
      state: "blocked",
      headline: "Automation has stopped",
      detail:
        "The background worker has not checked in for over five minutes, so nothing is running. If this does not clear on its own, restart the deployment.",
      interrupt: true,
    };
  }

  if (beating && input.phase && input.phase !== "ready") {
    return {
      ...base,
      state: "degraded",
      headline: `Automation is starting up`,
      detail: `The background worker is running but not ready yet (${input.phase}). Work will resume on its own.`,
      interrupt: false,
    };
  }

  if (incidents.length > 0 || (backlog != null && backlog >= BACKLOG_ALARM)) {
    const worst = incidents[0];
    return {
      ...base,
      state: "degraded",
      headline: "Automation is degraded",
      detail: worst
        ? `${worst.spec.title}. ${worst.spec.effect}`
        : `${backlog} jobs are waiting to run, which is more than usual. Work is still moving but is behind.`,
      interrupt: false,
    };
  }

  // Nothing has ever run and there is nothing to run: a quiet new account, not
  // a fault. Distinguished from "not running" so the sidebar does not accuse a
  // working install of being broken on its first afternoon.
  if (runs.length === 0) {
    return {
      ...base,
      state: "healthy",
      headline: "Running normally",
      detail: "Automation is connected and waiting. Nothing has been due to run yet.",
      interrupt: false,
    };
  }

  return {
    ...base,
    state: "healthy",
    headline: "Running normally",
    detail: lastSuccessAt
      ? "Automation is running and recent jobs have all succeeded."
      : "Automation is running.",
    interrupt: false,
  };
}

/** The tone a status chip should carry, paired with the label, never alone. */
export function stateTone(state: AutomationState): "good" | "warn" | "bad" | "neutral" {
  switch (state) {
    case "healthy":
      return "good";
    case "degraded":
      return "warn";
    case "blocked":
      return "bad";
    default:
      return "neutral";
  }
}
