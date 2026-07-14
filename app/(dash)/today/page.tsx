import Link from "next/link";
import { actionCenter, type ActionOppRow } from "@/lib/data";
import { PageHeader } from "@/components/badges";
import { PipelineStrip } from "@/components/pipeline-strip";
import { SetupChecklist } from "@/components/setup-checklist";
import { PAGE_HELP } from "@/lib/help-content";
import { integrationStatus } from "@/lib/config";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { computeSetupChecklist } from "@/lib/domain/setup";
import { flagSummary } from "@/lib/flag-labels";
import { currency, countdown, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * "Today", the guided home page. Answers one question the moment the
 * operator logs in: what should I do next, and why? Everything here is a
 * deep link into the exact place the work happens, ordered by urgency.
 */

const STAGE_LABEL: Record<string, string> = {
  monitoring: "Watching",
  scoring: "Being scored",
  analysis: "Being analyzed",
  sub_research: "Finding subs",
  outreach: "Contacting subs",
  call_queue: "Calls to make",
  quote_entry: "Collecting quotes",
  bid_building: "Building the bid",
  submitted: "Submitted",
  won: "Won",
  lost: "Lost",
  dismissed: "Dismissed",
};

function OppActionRow({
  o,
  action,
  detail,
}: {
  o: ActionOppRow;
  action: string;
  detail?: string;
}) {
  const expiry = o.deadline ? countdown(o.deadline) : null;
  return (
    <Link
      href={`/opportunity/${o.id}`}
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {o.title ?? "Untitled opportunity"}
        </p>
        <p className="mt-0.5 truncate text-xs text-slate-500">
          {[o.agency, o.value_estimated != null ? currency(o.value_estimated) : null]
            .filter(Boolean)
            .join(" · ")}
          {detail ? ` · ${detail}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {expiry && (
          <span
            className={`num text-xs ${expiry === "overdue" ? "text-risk" : "text-slate-500"}`}
          >
            due {expiry === "overdue" ? "now (overdue)" : `in ${expiry}`}
          </span>
        )}
        <span className="btn-ghost pointer-events-none text-xs">{action} →</span>
      </div>
    </Link>
  );
}

/**
 * A collapsible section with a prominent, green-underlined heading. Uses native
 * <details> so it needs no client JS; the chevron rotates when open.
 */
function Section({
  eyebrow,
  title,
  count,
  children,
}: {
  eyebrow: string;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <details open className="group">
      <summary className="flex cursor-pointer list-none items-end justify-between gap-3 border-b-2 border-accent/80 pb-2 [&::-webkit-details-marker]:hidden">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="mt-0.5 font-serif text-2xl font-semibold text-foreground">
            {title}
            {typeof count === "number" && (
              <span className="num ml-2 text-base font-normal text-slate-400">{count}</span>
            )}
          </h2>
        </div>
        <span
          aria-hidden
          className="mb-1 select-none text-slate-400 transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  );
}

export default async function TodayPage() {
  const [data, profile] = await Promise.all([actionCenter(), getActiveProfile()]);
  const integrations = integrationStatus();
  const setup = computeSetupChecklist({
    profile: profile?.profile_json ?? null,
    integrations,
  });

  // Items already surfaced in a more urgent section shouldn't repeat below it.
  const urgentIds = new Set(data.urgent.map((o) => o.id));
  const bidWork = data.bidWork.filter((o) => !urgentIds.has(o.id));
  const flagged = data.flagged.filter((o) => !urgentIds.has(o.id));

  const totalActions =
    data.urgent.length +
    data.triage.length +
    (data.calls.count > 0 ? 1 : 0) +
    bidWork.length +
    data.awaitingOutcome.length +
    flagged.length;

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        help={PAGE_HELP["today"]}
        title="Today"
        subtitle={
          totalActions === 0
            ? "Nothing needs you right now."
            : `${totalActions} thing${totalActions === 1 ? "" : "s"} need${totalActions === 1 ? "s" : ""} your attention, most urgent first.`
        }
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
       <div className="mx-auto w-full max-w-5xl space-y-8">
        {/* Pipeline progress rail */}
        <PipelineStrip counts={data.stageCounts} />

        {/* Guided setup, pinned up top until the platform is fully configured. */}
        <SetupChecklist checklist={setup} />

        {totalActions === 0 && setup.complete && (
          <div className="card mx-auto max-w-lg text-center">
            <p className="text-3xl">✅</p>
            <p className="mt-3 text-base font-semibold text-foreground">
              You&rsquo;re all caught up.
            </p>
            <p className="mt-1 text-sm text-slate-500">
              The agents check SAM.gov every 2 hours. Anything that needs a human
              decision will appear here, and you&rsquo;ll get an alert if a
              deadline gets close.
            </p>
          </div>
        )}

        {data.urgent.length > 0 && (
          <Section
            eyebrow="Do this first"
            title="Deadlines in the next 3 days"
            count={data.urgent.length}
          >
            {data.urgent.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action={o.has_bid ? "Review & submit" : "Open"}
                detail={`still ${STAGE_LABEL[o.stage]?.toLowerCase() ?? o.stage.replace(/_/g, " ")}`}
              />
            ))}
          </Section>
        )}

        {data.triage.length > 0 && (
          <Section
            eyebrow="Needs your decision"
            title="Decide: pursue or pass"
            count={data.triage.length}
          >
            <p className="-mt-1 text-sm text-slate-500">
              These scored in the borderline band, so the system wants your
              judgment. Unactioned items auto-dismiss when their timer runs out.
            </p>
            {data.triage.map((o) => (
              <OppActionRow key={o.id} o={o} action="Decide" />
            ))}
          </Section>
        )}

        {data.calls.count > 0 && (
          <Section eyebrow="Keep things moving" title="Calls to make" count={data.calls.count}>
            <Link
              href="/call-queue"
              className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-4 py-3 transition-colors hover:border-accent/60"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {data.calls.count} subcontractor call{data.calls.count === 1 ? "" : "s"} waiting
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  Each opens a guided workspace with the script, project details,
                  and a form that saves everything in one step.
                  {data.calls.soonest_deadline
                    ? ` Soonest bid deadline: ${shortDate(data.calls.soonest_deadline)}.`
                    : ""}
                </p>
              </div>
              <span className="btn-primary pointer-events-none shrink-0 text-xs">
                Start calling →
              </span>
            </Link>
          </Section>
        )}

        {bidWork.length > 0 && (
          <Section eyebrow="Keep things moving" title="Quotes & bids in progress" count={bidWork.length}>
            {bidWork.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action={
                  o.has_bid && !o.bid_submitted
                    ? "Review & submit bid"
                    : o.quote_count > 0
                      ? "Check quotes"
                      : "Enter quotes"
                }
                detail={
                  o.has_bid && !o.bid_submitted
                    ? "bid is priced and waiting for your sign-off"
                    : `${o.quote_count} quote${o.quote_count === 1 ? "" : "s"} entered so far`
                }
              />
            ))}
          </Section>
        )}

        {data.awaitingOutcome.length > 0 && (
          <Section
            eyebrow="Waiting on the government"
            title="Submitted, awaiting a decision"
            count={data.awaitingOutcome.length}
          >
            <p className="-mt-1 text-sm text-slate-500">
              When the agency announces, record the result so the platform can
              set up the contract (win) or learn from the loss.
            </p>
            {data.awaitingOutcome.map((o) => (
              <OppActionRow key={o.id} o={o} action="Record result" />
            ))}
          </Section>
        )}

        {flagged.length > 0 && (
          <Section eyebrow="Needs a look" title="Flagged by the system" count={flagged.length}>
            {flagged.map((o) => (
              <OppActionRow
                key={o.id}
                o={o}
                action="Open"
                detail={flagSummary(o.risk_flags ?? []) || undefined}
              />
            ))}
          </Section>
        )}

       </div>
      </div>
    </div>
  );
}
