import Link from "next/link";

/**
 * The pipeline progress rail on the Today page. A connected stepper: each stage
 * is a node showing its live count, joined by a rail that fills forest-green up
 * to the furthest stage that currently holds work. Nodes with work are filled;
 * empty ones are quiet. Clicking a node jumps to where that work lives.
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

export function PipelineStrip({ counts }: { counts: { stage: string; count: number }[] }) {
  const byStage = new Map(counts.map((c) => [c.stage, c.count]));
  const value = (k: string) => byStage.get(k) ?? 0;
  const total = STAGES.reduce((a, s) => a + value(s.key), 0);
  // Furthest stage that currently holds work (drives the filled portion of the rail).
  let lastActive = -1;
  STAGES.forEach((s, i) => {
    if (value(s.key) > 0) lastActive = i;
  });

  return (
    <div className="card scroll-thin overflow-x-auto">
      <div className="mb-4 flex items-baseline justify-between">
        <p className="eyebrow">Where your pipeline stands</p>
        <p className="text-xs text-slate-500">
          <span className="num font-semibold text-foreground">{total}</span> in
          play
        </p>
      </div>

      <div className="flex min-w-max items-start">
        {STAGES.map((s, i) => {
          const count = value(s.key);
          const active = count > 0;
          const connectorFilled = i < lastActive;
          return (
            <div key={s.key} className="flex items-start">
              <Link
                href={s.href}
                className="group flex w-[76px] flex-col items-center text-center"
              >
                <span
                  className={`num flex h-11 w-11 items-center justify-center rounded-full border-2 text-base font-semibold transition-all ${
                    active
                      ? "border-accent bg-accent text-white shadow-sm group-hover:bg-accent-strong"
                      : "border-border bg-background text-slate-300 group-hover:border-accent/50"
                  }`}
                >
                  {count}
                </span>
                <span
                  className={`mt-2 text-[0.62rem] font-medium uppercase leading-tight tracking-wide ${
                    active ? "text-slate-700" : "text-slate-400"
                  }`}
                >
                  {s.label}
                </span>
              </Link>
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={`mt-[21px] h-0.5 w-6 rounded-full ${
                    connectorFilled ? "bg-accent" : "bg-border"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
