import Link from "next/link";
import { timeAgo } from "@/lib/format";
import type { AutomationHealth, AutomationState } from "@/lib/domain/automation-health";

/**
 * The automation state, and what to do about it.
 *
 * The page this replaces led with a raw failure count -- "412 of 480 runs
 * failed" -- above a reverse-chronological feed of the 412. Every line was a
 * different stack trace of the same exhausted credit balance, so the page that
 * exists to answer "what is wrong and how do I fix it" answered neither: the
 * one cause was buried under its own symptoms, and the two OTHER things that
 * were also failing were somewhere on page nine.
 *
 * So failures are grouped by root cause before anything is rendered, each
 * group states its own repair, and the raw error goes under a disclosure. A
 * count is context for a cause, never a substitute for one.
 */

const TONE: Record<AutomationState, { border: string; text: string; glyph: string; word: string }> = {
  healthy: { border: "border-pursue/30 bg-pursue/5", text: "text-pursue", glyph: "●", word: "Healthy" },
  degraded: { border: "border-review/40 bg-review/10", text: "text-review", glyph: "▲", word: "Degraded" },
  blocked: { border: "border-risk/50 bg-risk/10", text: "text-risk", glyph: "✕", word: "Blocked" },
  paused: { border: "border-review/40 bg-review/10", text: "text-review", glyph: "⏸", word: "Paused" },
  not_configured: { border: "border-border bg-surface", text: "text-muted-foreground", glyph: "○", word: "Not set up" },
};

export function AutomationStatusPanel({
  health,
  nextRun,
}: {
  health: AutomationHealth;
  /** The soonest scheduled run, as an ISO string, or null when none is predictable. */
  nextRun?: string | null;
}) {
  const tone = TONE[health.state];
  const blocking = health.incidents.filter((i) => i.spec.blocking).length;
  // One workflow hit by three causes is one affected workflow, not three.
  const workflows = new Set(health.incidents.flatMap((i) => i.affectedWorkflows));
  const idle = health.state === "healthy" || health.state === "not_configured";
  return (
    <section
      aria-labelledby="automation-state"
      className={`rounded-md border px-4 py-4 ${tone.border}`}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* The word carries the state; the colour and glyph only reinforce it. */}
        <span aria-hidden className={`font-mono ${tone.text}`}>
          {tone.glyph}
        </span>
        <h2 id="automation-state" className={`font-display text-lg font-semibold ${tone.text}`}>
          {tone.word}
        </h2>
        <p className="min-w-0 flex-1 text-sm text-foreground">{health.detail}</p>
      </div>

      {/* The seven facts the audit asks this summary to carry. Each one has a
          reading for "we do not know", and none of them uses nought to mean it. */}
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <Fact
          label="Active incidents"
          value={
            health.incidents.length === 0
              ? "None"
              : `${health.incidents.length}${blocking > 0 ? `, ${blocking} blocking` : ""}`
          }
        />
        <Fact
          label="Workflows affected"
          value={workflows.size === 0 ? "None" : `${workflows.size}`}
        />
        {/*
          * "77 affected" beside "no active incidents" reads as a
          * contradiction, and on a paused account it was one: nothing was
          * failing, the work was simply switched off. The number is worth
          * saying either way; what it means depends on the state.
          */}
        <Fact
          label={health.state === "paused" ? "Open opportunities waiting" : "Open opportunities affected"}
          value={
            idle
              ? "None"
              : health.state === "paused"
                ? `${health.affectedOpportunities}, while paused`
                : `${health.affectedOpportunities}`
          }
        />
        {/* Not known rather than zero: the queue lives in a different backend
            depending on deployment, and an unknown shown as 0 is how a growing
            backlog stays invisible. */}
        <Fact label="Jobs waiting" value={health.backlog == null ? "Not measured" : `${health.backlog}`} />
        {/*
          * A rate of nought claims a perfect record, and an account where
          * nothing ran has no record to be perfect. The two absences read
          * differently on purpose: nothing ran at all, or too little ran to
          * draw a rate from.
          */}
        <Fact
          label="Failure rate (24h)"
          value={
            health.failureRate == null
              ? health.runs24h === 0
                ? "No runs in 24 hours"
                : `Too few runs to say (${health.runs24h})`
              : `${Math.round(health.failureRate * 100)}% of ${health.runs24h}`
          }
        />
        <Fact
          label="Last successful run"
          value={health.lastSuccessAt ? timeAgo(health.lastSuccessAt) : "None in 24 hours"}
        />
        <Fact
          label="Next scheduled run"
          value={
            health.state === "paused"
              ? "Paused, nothing scheduled"
              : nextRun
                ? timeUntil(nextRun)
                : "Not scheduled"
          }
        />
      </dl>
    </section>
  );
}

/**
 * How long until a moment, in the words somebody waiting would use.
 *
 * Deliberately not `timeAgo` with a sign flipped: "in 12 minutes" is the
 * sentence that stops an operator manually re-running work that was about to
 * happen on its own, and it has to read forward.
 */
function timeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "Not scheduled";
  if (ms <= 0) return "Due now";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "In under a minute";
  if (mins < 60) return `In ${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `In ${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `In ${days} day${days === 1 ? "" : "s"}`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm text-foreground">{value}</dd>
    </div>
  );
}

export function AutomationIncidents({ health }: { health: AutomationHealth }) {
  if (health.incidents.length === 0) return null;
  return (
    <section aria-labelledby="automation-incidents" className="space-y-3">
      <h2 id="automation-incidents" className="label">
        Incidents, grouped by cause
      </h2>
      {health.incidents.map((incident) => (
        <article
          key={incident.cause}
          className={`rounded-md border px-4 py-3 ${
            incident.spec.blocking ? "border-risk/40 bg-risk/5" : "border-review/30 bg-review/5"
          }`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-base font-semibold text-foreground">
              {incident.spec.title}
            </h3>
            <span className="text-xs text-muted-foreground">
              {incident.failures > 0
                ? `${incident.failures} failure${incident.failures === 1 ? "" : "s"}, first ${timeAgo(incident.firstSeen)}`
                : `Detected ${timeAgo(incident.lastSeen)}`}
            </span>
          </div>

          <p className="mt-1 text-sm text-foreground">{incident.spec.effect}</p>

          {incident.affectedWorkflows.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              Affected: {incident.affectedWorkflows.slice(0, 6).join(", ")}
              {incident.affectedWorkflows.length > 6
                ? ` and ${incident.affectedWorkflows.length - 6} more`
                : ""}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-foreground">
              <span className="label mr-1 inline">Fix</span>
              {incident.spec.repair}
            </p>
            {incident.spec.repairHref && (
              <Link href={incident.spec.repairHref} className="btn-ghost shrink-0 text-xs">
                Open Integrations
              </Link>
            )}
          </div>

          {incident.sample && (
            /* The raw error is kept, not hidden: an operator does not need it
               and a support engineer cannot work without it. */
            <details className="mt-3">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Technical details
              </summary>
              <pre className="scroll-thin mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-[0.7rem] text-muted-foreground">
                {incident.sample}
              </pre>
            </details>
          )}
        </article>
      ))}
    </section>
  );
}

/**
 * The account-wide banner, for pages that are not Automation Health.
 *
 * Only shown when something is genuinely stopped. A banner that appears for
 * every degradation is a banner people learn to scroll past, and the one time
 * it matters they will.
 */
export function AutomationBlockerBanner({ health }: { health: AutomationHealth }) {
  if (!health.interrupt) return null;
  const worst = health.incidents.find((i) => i.spec.blocking);
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-risk/50 bg-risk/10 px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span aria-hidden className="font-mono text-risk">
          {"✕"}
        </span>
        <p className="font-display text-sm font-semibold text-risk">{health.headline}</p>
        <p className="min-w-0 flex-1 text-sm text-foreground">{health.detail}</p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        {worst && <p className="min-w-0 flex-1 text-foreground">{worst.spec.repair}</p>}
        <Link href="/agents" className="btn-ghost shrink-0 text-xs">
          Open Automation Health
        </Link>
      </div>
    </div>
  );
}
