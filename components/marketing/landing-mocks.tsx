/**
 * Decorative product mockups for the marketing landing page.
 * Static illustrations only; they teach the product story without implying live data.
 */

export function PulseMock() {
  return (
    <div
      aria-hidden
      className="mkt-mock relative mx-auto w-full max-w-4xl overflow-hidden rounded-lg border border-white/10 bg-[#141414] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.65)]"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 animate-pulse rounded-full bg-pursue" />
          <span className="text-xs font-medium text-white/80">Today · live pulse</span>
        </div>
        <span className="text-[11px] text-white/40">Pipeline health</span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1.2fr_0.8fr]">
        <div className="divide-y divide-white/10 border-b border-white/10 md:border-b-0 md:border-r">
          {[
            ["Review", "HVAC maintenance · Sacramento VA", "Score 62"],
            ["Call", "Bay Area Mechanical · roofing quote", "Due 3d"],
            ["Coverage", "2 trades open · janitorial recompete", "Action"],
            ["Submitted", "Landscape IDIQ · NAVFAC", "Waiting"],
          ].map(([tag, title, meta]) => (
            <div key={title} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.12em] text-gold">{tag}</p>
                <p className="mt-1 truncate text-sm text-white/90">{title}</p>
              </div>
              <span className="shrink-0 text-[11px] text-white/45">{meta}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-end gap-3 px-4 py-5">
          <p className="text-[10px] uppercase tracking-[0.12em] text-white/40">Stage load</p>
          <div className="flex h-28 items-end gap-2">
            {[40, 65, 35, 80, 55, 70, 45].map((h, i) => (
              <div
                key={i}
                className="flex-1 rounded-sm bg-gradient-to-t from-gold/30 to-gold/80"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <p className="text-[11px] text-white/45">Find · Triage · Capture · Bid</p>
        </div>
      </div>
    </div>
  );
}

export function OpportunityMock() {
  return (
    <div
      aria-hidden
      className="mkt-mock overflow-hidden rounded-lg border border-border bg-background shadow-[0_30px_60px_-24px_rgba(36,36,36,0.35)]"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            Opportunity
          </p>
          <p className="font-display text-lg text-foreground">Boise VA Renovation</p>
        </div>
        <span className="rounded-md bg-pursue-soft px-2 py-1 text-xs font-medium text-pursue-strong">
          Score 74
        </span>
      </div>
      <div className="grid gap-0 md:grid-cols-[1fr_0.7fr]">
        <div className="space-y-3 border-b border-border p-4 md:border-b-0 md:border-r">
          <p className="text-xs font-medium text-foreground">What needs you</p>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex gap-2">
              <span className="text-gold">1.</span> Follow up with ABC Mechanical (HVAC)
            </li>
            <li className="flex gap-2">
              <span className="text-gold">2.</span> Review electrical quote received today
            </li>
          </ul>
          <div className="mt-4 rounded-md border border-accent/25 bg-accent-soft px-3 py-2 text-xs leading-relaxed text-slate-700">
            Guide Me: HVAC pricing is still missing. Brost Co cannot finalize the bid until
            every required trade has a quote.
          </div>
        </div>
        <div className="space-y-3 p-4">
          <p className="text-xs font-medium text-foreground">Fit breakdown</p>
          {[
            ["Trade fit", 86],
            ["Geography", 72],
            ["Set-aside", 90],
            ["Deadline", 64],
          ].map(([label, pct]) => (
            <div key={String(label)}>
              <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                <span>{label}</span>
                <span className="num">{pct}</span>
              </div>
              <div className="h-1.5 rounded-full bg-surface">
                <div
                  className="h-1.5 rounded-full bg-gold"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AnalysisMock() {
  return (
    <div
      aria-hidden
      className="mkt-mock overflow-hidden rounded-lg border border-border bg-background p-5 shadow-[0_30px_60px_-24px_rgba(36,36,36,0.45)]"
    >
      <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        Opportunity analysis
      </p>
      <p className="mt-1 font-display text-xl text-foreground">Why this is a go</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-pursue-strong">Strengths</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>NAICS and set-aside match your profile</li>
            <li>Place of performance inside service areas</li>
            <li>Deadline leaves room for sub pricing</li>
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-review">Watch</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            <li>HVAC coverage still thin</li>
            <li>Past performance accepted as team experience</li>
          </ul>
        </div>
      </div>
      <p className="mt-4 border-t border-border pt-3 text-xs leading-relaxed text-slate-600">
        Brost Co scored this 74 and wrote the brief so you decide in minutes, not hours of
        solicitation reading.
      </p>
    </div>
  );
}

export function CoverageMock() {
  return (
    <div
      aria-hidden
      className="mkt-mock overflow-hidden rounded-lg border border-border bg-background shadow-[0_30px_60px_-24px_rgba(36,36,36,0.28)]"
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
          Trade coverage
        </p>
        <p className="font-display text-lg text-foreground">Nothing falls out of the pursuit</p>
      </div>
      <div className="grid grid-cols-[1.1fr_1fr_0.8fr_1.2fr] gap-0 border-b border-border bg-surface text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        <span className="px-3 py-2">Trade</span>
        <span className="px-3 py-2">Status</span>
        <span className="px-3 py-2">Subs</span>
        <span className="px-3 py-2">Next</span>
      </div>
      {[
        ["HVAC", "Needs follow-up", "3", "Call ABC Mechanical"],
        ["Electrical", "Quoted", "4", "Review quote"],
        ["Plumbing", "Quoted", "2", "Covered"],
        ["Controls", "Thin", "1", "Find more subs"],
      ].map((row) => (
        <div
          key={row[0]}
          className="grid grid-cols-[1.1fr_1fr_0.8fr_1.2fr] border-b border-border text-sm last:border-b-0"
        >
          <span className="px-3 py-2.5 font-medium text-foreground">{row[0]}</span>
          <span className="px-3 py-2.5 text-muted-foreground">{row[1]}</span>
          <span className="num px-3 py-2.5 text-foreground">{row[2]}</span>
          <span className="px-3 py-2.5 text-xs text-muted-foreground">{row[3]}</span>
        </div>
      ))}
    </div>
  );
}
