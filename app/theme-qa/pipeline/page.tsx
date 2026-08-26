import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PIPELINE_STAGES } from "@/lib/data";
import { stageMode } from "@/lib/stage-meta";
import { SwipeRail } from "@/components/swipe-rail";
import { ScoreBadge } from "@/components/badges";
import { DeadlineBadge } from "@/components/deadline-badge";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mobile pipeline lab",
  description: "Development-only check of the swipeable mobile pipeline rail.",
  robots: { index: false, follow: false },
};

/**
 * The mobile pipeline rail, on fixture data.
 *
 * The pipeline board needs a database, so it cannot be opened anywhere the
 * database is unreachable, which is exactly where its layout most needs
 * looking at. This renders the real SwipeRail and the real column markup
 * against fixtures so the swipe, the peek, the chip rail and the column
 * heights can be checked in a browser.
 *
 * Dev only, like the rest of theme-qa: 404s in production.
 */

const NEXT_ACTION: Record<string, string> = {
  monitoring: "Awaiting scoring",
  scoring: "Scoring in progress",
  analysis: "Analyst + Pricing running",
  sub_research: "Finding subs",
  outreach: "Outreach in flight",
  call_queue: "Call the sub",
  quote_entry: "Enter quote",
  bid_building: "Review & submit bid",
  submitted: "Awaiting award",
  won: "Set up contract",
  lost: "Archived",
};

interface Fixture {
  id: string;
  title: string;
  score: number;
  value: number;
  deadline: string;
  needsYou?: boolean;
}

/** Deterministic fixtures: same picture on every load, so diffs are real. */
function cardsFor(stage: string): Fixture[] {
  const counts: Record<string, number> = {
    monitoring: 2,
    scoring: 1,
    analysis: 3,
    sub_research: 1,
    outreach: 4,
    call_queue: 2,
    quote_entry: 1,
    bid_building: 2,
    submitted: 1,
    won: 1,
    lost: 0,
  };
  const n = counts[stage] ?? 0;
  return Array.from({ length: n }, (_, i) => ({
    id: `${stage}-${i}`,
    title:
      i % 3 === 0
        ? "HVAC replacement, Building 400 mechanical room, Robins AFB"
        : i % 3 === 1
          ? "Grounds maintenance IDIQ"
          : "Roof replacement and associated sheet metal work",
    score: 91 - i * 7,
    value: 120_000 + i * 45_000,
    deadline: new Date(Date.UTC(2026, 8, 4 + i * 5)).toISOString(),
    needsYou: stageMode(stage) === "you" && i === 0,
  }));
}

export default function MobilePipelineLab() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="shrink-0 border-b border-border/55 px-4 py-3">
        <p className="eyebrow">Theme QA</p>
        <h1 className="font-display text-lg">Mobile pipeline rail</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Fixtures, not live data. Resize to a phone width to see the rail.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <SwipeRail
          ariaLabel="Pipeline"
          items={PIPELINE_STAGES.map((stage) => ({
            key: stage.key,
            label: stage.label,
            count: cardsFor(stage.key).length,
            attention: stageMode(stage.key) === "you",
          }))}
        >
          {PIPELINE_STAGES.map((stage) => {
            const cards = cardsFor(stage.key);
            return (
              <Column
                key={stage.key}
                title={stage.label}
                blurb={NEXT_ACTION[stage.key]}
                count={cards.length}
                badge={
                  stageMode(stage.key) === "you"
                    ? "bg-review/15 text-review"
                    : "bg-muted text-muted-foreground"
                }
                badgeLabel={stageMode(stage.key) === "you" ? "Needs you" : "Automatic"}
              >
                {cards.map((c) => (
                  <Card key={c.id} fixture={c} stageKey={stage.key} />
                ))}
              </Column>
            );
          })}
        </SwipeRail>
      </div>
    </div>
  );
}

/** Mirrors MobileColumn in the pipeline page. */
function Column({
  title,
  blurb,
  count,
  badge,
  badgeLabel,
  children,
}: {
  title: string;
  blurb?: string;
  count: number;
  badge?: string;
  badgeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 shrink-0 pb-1">
        <div className="flex items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <span className="num text-xs text-muted-foreground">{count}</span>
          {badgeLabel && <span className={`badge ml-auto ${badge}`}>{badgeLabel}</span>}
        </div>
        {blurb && (
          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{blurb}</p>
        )}
      </div>
      <div className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto pb-2">
        {count === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Nothing here right now.
          </p>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

/**
 * Mirrors PipelineCard without the routing and menu.
 *
 * Including the next-action line matters: the production card's whole job is
 * telling the operator whose turn it is and what happens next, and a fixture
 * without it made screenshots understate the product during visual QA.
 */
function Card({ fixture, stageKey }: { fixture: Fixture; stageKey: string }) {
  return (
    <div
      className={`card block ${
        fixture.needsYou ? "focus-rail border-gold/40 bg-gold/[0.04]" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-sm font-medium text-foreground">{fixture.title}</p>
        <ScoreBadge score={fixture.score} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="num">${fixture.value.toLocaleString()}</span>
        <DeadlineBadge deadline={fixture.deadline} />
      </div>
      <p className="mt-2 text-xs font-semibold text-accent-strong">
        {NEXT_ACTION[stageKey] ?? stageKey}
        <span className="ml-1 font-medium text-gold-text">Open ↗</span>
      </p>
    </div>
  );
}
