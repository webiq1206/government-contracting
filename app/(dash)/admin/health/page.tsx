import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/page-frame";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import {
  agentRunFacts,
  recentFailures,
  platformImpact,
  providerCapacityState,
  WINDOW_HOURS,
  FAILURE_SAMPLE_LIMIT,
} from "@/lib/admin/platform-health";
import { webhookPulse } from "@/lib/billing/admin";
import { webhookHealth } from "@/lib/domain/billing-reconciliation";
import {
  serviceStatuses,
  platformStatus,
  platformIncidents,
  refreshedLabel,
  type ServiceState,
} from "@/lib/domain/platform-health";
import { INCIDENT_SPECS } from "@/lib/domain/automation-health";
import { timeAgo } from "@/lib/format";

export const dynamic = "force-dynamic";

const TONE: Record<ServiceState, { badge: string; text: string; word: string }> = {
  healthy: { badge: "bg-pursue/15 text-pursue", text: "text-pursue", word: "Working" },
  degraded: { badge: "bg-review/15 text-review", text: "text-review", word: "Degraded" },
  down: { badge: "bg-risk/15 text-risk", text: "text-risk", word: "Down" },
  // Not a colour of its own: unknown is the absence of evidence, and giving it
  // a status colour would make a silent service look like a judged one.
  unknown: { badge: "bg-slate-200 text-slate-600", text: "text-muted-foreground", word: "Not run" },
};

/**
 * Whether the platform is working, across every tenant.
 *
 * Automation Health answers this for one account and answers it well. Nothing
 * answered it for the platform, so an outage affecting every customer had to
 * be found one organization at a time, by an administrator who happened to
 * open the right account. The platform's worst failures were the ones it was
 * slowest to notice.
 *
 * Admin only, and 404 rather than 403 for anybody else: naming the page tells
 * a signed-in customer it exists and is worth attacking.
 */
export default async function PlatformHealthPage() {
  const auth = await requirePlatformAdmin();
  if (auth instanceof Response) notFound();

  const refreshedAt = new Date();
  const [facts, failures, impact, pulse, depth] = await Promise.all([
    agentRunFacts(),
    recentFailures(),
    platformImpact(),
    webhookPulse(),
    /*
     * Queue depth is deliberately not measured.
     *
     * The queue lives in a different backend depending on deployment, and
     * nothing in this codebase can read a depth from all of them. The honest
     * answer is that it is unknown, which the service card says in those
     * words; reporting nought would be how a growing backlog stays invisible
     * on the one page that exists to notice it.
     */
    Promise.resolve<number | null>(null),
  ]);

  const webhook = webhookHealth(pulse.lastEventAt, pulse.billableAccounts, refreshedAt);
  const services = serviceStatuses(facts, {
    billingWebhooks: {
      state: webhook.state === "stale" || webhook.state === "never" ? "degraded" : "healthy",
      detail: `${webhook.label}. ${webhook.detail}`,
    },
    providerCapacity: providerCapacityState(failures.rows),
    queueDepth: depth,
  });
  const platform = platformStatus(services);
  const incidents = platformIncidents(failures.rows);
  const tone = TONE[
    platform.state === "major_outage"
      ? "down"
      : platform.state === "degraded"
        ? "degraded"
        : platform.state === "unknown"
          ? "unknown"
          : "healthy"
  ];

  return (
    <>
      <PageFrame
        breadcrumbs={[{ label: "Platform admin" }]}
        title="System health"
        explanation={`Every service, every tenant, over the last ${WINDOW_HOURS} hours. This is the platform, not one account.`}
        status={`${platform.headline} · read at ${refreshedLabel(refreshedAt)}`}
      />
      <div className="scroll-thin flex-1 space-y-6 overflow-y-auto p-5">
        {/* 1. Overall status, and when this was read. */}
        <section
          aria-labelledby="platform-state"
          className={`rounded-md border px-4 py-4 ${
            platform.state === "major_outage"
              ? "border-risk/50 bg-risk/10"
              : platform.state === "degraded"
                ? "border-review/40 bg-review/10"
                : "border-border bg-surface"
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="platform-state" className={`font-display text-lg font-semibold ${tone.text}`}>
              {platform.headline}
            </h2>
            <p className="min-w-0 flex-1 text-sm text-foreground">{platform.detail}</p>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Read at {refreshedLabel(refreshedAt)}. Nothing on this page updates on its own;
            reload it to ask again.
          </p>
        </section>

        {/* 4. Who and what is affected. */}
        <section aria-labelledby="platform-impact">
          <h2 id="platform-impact" className="label mb-2">
            What is behind it
          </h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Impact
              label="Accounts with failures"
              value={impact.orgsAffected}
              tone={impact.orgsAffected > 0 ? "risk" : undefined}
            />
            <Impact label="Opportunities unscored" value={impact.unscored} />
            <Impact label="Waiting on outreach" value={impact.awaitingOutreach} />
            <Impact
              label="Email not delivered"
              value={impact.undeliveredEmail}
              tone={impact.undeliveredEmail > 0 ? "review" : undefined}
            />
          </dl>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Counted across every tenant, because the question here is how large a failure is
            rather than whose it is. Unscored and waiting counts include work that is simply
            new, so they matter as a trend more than as a number.
          </p>
        </section>

        {/* 5. Incidents, grouped by cause rather than by tenant. */}
        {incidents.length > 0 && (
          <section aria-labelledby="platform-incidents" className="space-y-2">
            <h2 id="platform-incidents" className="label">
              Incidents, grouped by cause across every account
            </h2>
            {failures.truncated && (
              <p className="text-xs text-review">
                Reading the most recent {FAILURE_SAMPLE_LIMIT.toLocaleString()} failures only, so
                these counts are a floor rather than a total.
              </p>
            )}
            {incidents.map((i) => {
              const spec = INCIDENT_SPECS[i.cause];
              return (
                <article
                  key={i.cause}
                  className={`card ${
                    i.blocking ? "border-risk/40 bg-risk/5" : "border-review/30 bg-review/5"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="font-display text-base font-semibold text-foreground">
                      {spec.title}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {i.failures} failure{i.failures === 1 ? "" : "s"}
                      {i.orgs > 0
                        ? ` across ${i.orgs} account${i.orgs === 1 ? "" : "s"}`
                        : ", none tied to an account"}
                      , first {timeAgo(i.firstSeen)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{spec.effect}</p>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Hit: {i.agents.slice(0, 8).join(", ")}
                    {i.agents.length > 8 ? ` and ${i.agents.length - 8} more` : ""}
                  </p>
                  <p className="mt-2 text-sm text-foreground">
                    <span className="label mr-1.5 inline">Fix:</span>
                    {spec.repair}
                  </p>
                  {i.sample && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        Technical details
                      </summary>
                      <pre className="scroll-thin mt-1 overflow-x-auto rounded bg-slate-100 p-2 text-xs text-slate-700">
                        {i.sample}
                      </pre>
                    </details>
                  )}
                </article>
              );
            })}
          </section>
        )}

        {/* 3. The nine services. */}
        <section aria-labelledby="platform-services" className="space-y-2">
          <h2 id="platform-services" className="label">
            Services
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <article key={s.key} className="card flex flex-col gap-1.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">{s.label}</h3>
                  <span className={`badge shrink-0 ${TONE[s.state].badge}`}>
                    {s.stateWord ?? TONE[s.state].word}
                  </span>
                </div>
                <p className="text-xs leading-relaxed text-slate-600">{s.detail}</p>
                {s.state !== "healthy" && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{s.impact}</p>
                )}
                {s.lastRunAt && (
                  <p className="mt-auto pt-1 text-xs text-muted-foreground">
                    Last run {timeAgo(s.lastRunAt)}
                  </p>
                )}
              </article>
            ))}
          </div>
        </section>

        {/* 7. Where the history lives. */}
        <p className="text-sm text-muted-foreground">
          Per-account detail is on{" "}
          <Link href="/agents" className="font-medium text-accent hover:underline">
            Automation Health
          </Link>
          , billing delivery on{" "}
          <Link href="/admin/billing" className="font-medium text-accent hover:underline">
            Customer billing
          </Link>
          , and administrative actions in the{" "}
          <Link href="/admin/audit" className="font-medium text-accent hover:underline">
            audit log
          </Link>
          .
        </p>
      </div>
    </>
  );
}

function Impact({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "risk" | "review";
}) {
  return (
    <div className="panel-inset p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd
        className={`num text-2xl font-semibold ${
          tone === "risk" ? "text-risk" : tone === "review" ? "text-review" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
