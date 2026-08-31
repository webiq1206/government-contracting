import Link from "next/link";
import { DetailDrawer, DrawerFact, DrawerSection } from "@/components/detail-drawer";
import { ActionButton } from "@/components/action-button";
import type { AgentRunDetail } from "@/lib/data";

/**
 * One automation run, in full, without leaving the log.
 *
 * `agent_logs` has stored `input_json`, `output_json`, `opportunity_id`,
 * `subcontractor_id` and `bid_id` all along, and the log rendered none of
 * them. So the one screen somebody opens precisely when something is broken
 * was withholding the request that failed, the response that came back, and
 * the record it happened to. The message and the reasoning are a summary of
 * an event whose evidence was one column away.
 *
 * The payloads are collapsed by default. They are frequently thousands of
 * characters, and a drawer that opens onto a wall of JSON buries the sentence
 * that usually answers the question.
 */
export function AgentRunPeek({
  run,
  closeHref,
  nav,
  canRun,
}: {
  run: AgentRunDetail;
  closeHref: string;
  nav?: {
    prevHref: string | null;
    nextHref: string | null;
    index: number;
    total: number;
  };
  /** Re-running is a write. Offered only to a role that could actually do it. */
  canRun: boolean;
}) {
  const when = new Date(run.created_at);
  const level = (run.level || "info").toLowerCase();
  const tone =
    level === "error"
      ? "bg-risk/15 text-risk"
      : level === "warn" || level === "warning"
        ? "bg-review/15 text-review"
        : "bg-muted text-muted-foreground";

  const links: { label: string; href: string }[] = [];
  if (run.opportunity_id) {
    links.push({
      label: run.opportunity_title ?? "The solicitation it ran on",
      href: `/opportunity/${run.opportunity_id}`,
    });
  }
  if (run.subcontractor_id) {
    links.push({
      label: run.subcontractor_name ?? "The subcontractor it touched",
      href: `/subs/${run.subcontractor_id}`,
    });
  }
  if (run.bid_id && run.bid_opportunity_id) {
    links.push({
      label: "The bid package it was building",
      href: `/opportunity/${run.bid_opportunity_id}#submission`,
    });
  }

  return (
    <DetailDrawer
      title={`${run.agent} · ${run.action}`}
      subtitle={when.toLocaleString()}
      closeHref={closeHref}
      openHref={links[0]?.href ?? closeHref}
      openLabel={links[0] ? "Open the record it touched" : "Back to the log"}
      nav={nav}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          {canRun ? (
            <ActionButton
              endpoint={`/api/agents/${encodeURIComponent(run.agent)}/run`}
              className="btn-ghost text-xs"
              successText="Queued. The log updates when it finishes."
            >
              Run {run.agent} again
            </ActionButton>
          ) : (
            <span className="text-xs text-muted-foreground">
              Running an agent needs a role that can change things.
            </span>
          )}
          {nav?.nextHref && (
            <Link href={nav.nextHref} className="btn-primary ml-auto text-xs">
              Next entry
            </Link>
          )}
        </div>
      }
    >
      <DrawerSection title="What happened">
        <DrawerFact
          label="Result"
          value={
            <span className="flex flex-wrap items-center gap-1.5">
              <span className={`badge ${tone}`}>{level}</span>
              <span className="text-foreground">{run.status}</span>
            </span>
          }
        />
        <DrawerFact label="What it said" value={run.message} unknown="Nothing was recorded" />
        <DrawerFact
          label="Why"
          value={run.reasoning}
          unknown="No reasoning was recorded for this run"
        />
        <DrawerFact
          label="How long"
          value={run.duration_ms == null ? null : `${run.duration_ms} ms`}
          unknown="Not timed"
        />
      </DrawerSection>

      <DrawerSection title="What it ran on">
        {links.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This run names no record. Scheduled sweeps and health checks are the
            usual reason; a failure that names nothing is harder to act on and
            worth reporting.
          </p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {links.map((l) => (
              <li key={l.href}>
                <Link
                  href={l.href}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </DrawerSection>

      <Payload title="What it was given" value={run.input_json} />
      <Payload title="What it returned" value={run.output_json} />
    </DetailDrawer>
  );
}

/**
 * One stored JSON blob, behind a disclosure.
 *
 * `<details>` rather than a toggle in state, so the drawer stays a server
 * component and the whole log page ships no extra JavaScript for it.
 */
function Payload({ title, value }: { title: string; value: unknown }) {
  if (value == null) {
    return (
      <section>
        <h3 className="label mb-2">{title}</h3>
        <p className="text-sm text-muted-foreground">
          Nothing was stored. Older runs predate this being recorded.
        </p>
      </section>
    );
  }
  let text: string;
  try {
    text = JSON.stringify(value, null, 2);
  } catch {
    // A payload that will not serialise is itself worth seeing said out loud.
    text = String(value);
  }
  const lines = text.split("\n").length;
  return (
    <section>
      <details>
        <summary className="label cursor-pointer list-none">
          {title}
          <span className="num ml-1.5 font-sans normal-case tracking-normal text-muted-foreground">
            {lines} line{lines === 1 ? "" : "s"}
          </span>
        </summary>
        <pre className="scroll-thin mt-2 max-h-80 overflow-auto rounded-md border border-border/60 bg-surface p-3 text-xs text-foreground dark:border-white/10">
          {text}
        </pre>
      </details>
    </section>
  );
}
