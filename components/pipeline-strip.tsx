import Link from "next/link";
import { stageMode } from "@/lib/stage-meta";
import { CALL_STAGE } from "@/lib/domain/call-step";

/**
 * The pipeline progress rail on the Today page. A connected stepper: each stage
 * is a node showing its live count, joined by a rail that fills up to the
 * furthest stage that currently holds work. Color carries meaning: a node with
 * work is green when the system is handling it and amber when it is waiting on
 * you; an empty stage is a quiet outline. Clicking a node jumps to the work.
 *
 * On phones the nodes wrap in a compact grid instead of forcing horizontal scroll.
 */

interface Stage {
  key: string;
  label: string;
  href: string;
}

const STAGES: Stage[] = [
  { key: "monitoring", label: "Watching", href: "/pipeline" },
  { key: "scoring", label: "Scoring", href: "/pipeline" },
  { key: "analysis", label: "Analyzing", href: "/pipeline" },
  { key: "sub_research", label: "Finding subs", href: "/pipeline" },
  { key: "outreach", label: "Contacting", href: "/pipeline" },
  { key: "call_queue", label: "Calls", href: "/call-queue" },
  { key: "quote_entry", label: "Quotes", href: "/pipeline" },
  { key: "bid_building", label: "Bidding", href: "/pipeline" },
  { key: "submitted", label: "Submitted", href: "/pipeline" },
];

function StageNode({
  s,
  count,
  active,
  needsYou,
}: {
  s: Stage;
  count: number;
  active: boolean;
  needsYou: boolean;
}) {
  return (
    <Link href={s.href} className="group flex flex-col items-center text-center">
      <span
        className={`num flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-semibold transition-all ${
          active
            ? needsYou
              ? "border-review bg-review text-on-status shadow-sm group-hover:brightness-95"
              : "border-pursue bg-pursue text-on-status shadow-sm group-hover:bg-pursue-strong"
            : "border-border bg-background text-slate-300 group-hover:border-pursue/50"
        }`}
      >
        {count}
      </span>
      <span
        className={`mt-2 text-[0.62rem] font-medium uppercase leading-tight tracking-wide ${
          active
            ? needsYou
              ? "text-review"
              : "text-slate-700"
            : "text-slate-500"
        }`}
      >
        {s.label}
      </span>
    </Link>
  );
}

export function PipelineStrip({
  counts,
  callsEnabled = true,
}: {
  counts: { stage: string; count: number }[];
  /** False on an email-only account: the call node is not part of the rail. */
  callsEnabled?: boolean;
}) {
  const byStage = new Map(counts.map((c) => [c.stage, c.count]));
  const value = (k: string) => byStage.get(k) ?? 0;
  // Drop the call node when calling is off, unless something is still sitting
  // in that stage: a rail that hides live work would undercount "in play".
  const stages = STAGES.filter(
    (s) => callsEnabled || s.key !== CALL_STAGE || value(s.key) > 0
  );
  const total = stages.reduce((a, s) => a + value(s.key), 0);
  let lastActive = -1;
  stages.forEach((s, i) => {
    if (value(s.key) > 0) lastActive = i;
  });

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">Where your opportunities stand</p>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-pursue" /> automatic
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-review" /> needs you
          </span>
          <span className="hidden sm:inline">
            <span className="num font-semibold text-foreground">{total}</span> in play
          </span>
        </div>
      </div>

      {/* Mobile: the same left-to-right pipeline, swiped. A wrapped grid put
          Submitted underneath Watching, which reads as a second pipeline
          rather than the end of the first one. */}
      <div className="hide-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 sm:hidden">
        {stages.map((s) => {
          const count = value(s.key);
          return (
            <div key={s.key} className="w-[68px] shrink-0">
              <StageNode
                s={s}
                count={count}
                active={count > 0}
                needsYou={stageMode(s.key) === "you"}
              />
            </div>
          );
        })}
      </div>

      {/* sm+: connected horizontal rail (scrolls only if the viewport is tight). */}
      <div className="scroll-thin hidden overflow-x-auto sm:block">
        <div className="flex min-w-max items-start">
          {stages.map((s, i) => {
            const count = value(s.key);
            const active = count > 0;
            const needsYou = stageMode(s.key) === "you";
            const connectorFilled = i < lastActive;
            return (
              <div key={s.key} className="flex items-start">
                <div className="w-[76px]">
                  <StageNode s={s} count={count} active={active} needsYou={needsYou} />
                </div>
                {i < stages.length - 1 && (
                  <span
                    aria-hidden
                    className={`mt-[21px] h-0.5 w-6 rounded-full ${
                      connectorFilled ? "bg-pursue" : "bg-border"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
