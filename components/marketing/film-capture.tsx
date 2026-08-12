"use client";

import { useEffect, type ReactElement } from "react";
import { ThemeWordmark } from "@/components/theme-wordmark";
import { PageHeader, ScoreBadge } from "@/components/badges";

const NAV = [
  { n: "01", label: "Today", hint: "Everything that needs you", id: "today" },
  { n: "02", label: "Call Queue", hint: "Work calls one after another", id: "calls", badge: 2 },
  { n: "03", label: "Opportunities", hint: "Every opportunity, by whose turn it is", id: "opps" },
  { n: "04", label: "Review", hint: "Borderline opportunities to pursue or pass", id: "review", badge: 1 },
] as const;

function Callout({ text, x, y }: { text: string; x: string; y: string }) {
  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[240px] border border-gold/50 bg-[#0f100e]/92 px-3 py-2 text-[13px] leading-snug text-[#f6f2eb] shadow-[0_12px_40px_rgba(0,0,0,.45)]"
      style={{ left: x, top: y }}
    >
      {text}
    </div>
  );
}

function Shell({
  active,
  children,
}: {
  active: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/10 bg-background">
        <div className="px-5 py-6">
          <ThemeWordmark className="h-7 w-auto" />
          <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
            Workspace
          </p>
        </div>
        <div className="space-y-1 px-3">
          {NAV.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-2 rounded-md px-2 py-2 ${
                item.id === active ? "bg-gold/15 text-foreground" : "text-muted-foreground"
              }`}
            >
              <span className="w-6 font-mono text-[10px] text-gold">{item.n}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">{item.label}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">{item.hint}</span>
              </span>
              {"badge" in item && item.badge ? (
                <span className="badge rounded-full bg-gold px-1.5 text-ink">{item.badge}</span>
              ) : null}
            </div>
          ))}
        </div>
        <div className="mt-auto border-t border-white/10 px-4 py-4">
          <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 animate-pulse rounded-full bg-pursue" />
            Running normally · 12 min ago
          </p>
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col bg-background">{children}</main>
    </div>
  );
}

function Rail() {
  const stages = [
    { n: 14, l: "Watching", on: true },
    { n: 3, l: "Scoring", on: true },
    { n: 2, l: "Analyzing", on: true },
    { n: 4, l: "Finding subs", on: true },
    { n: 6, l: "Contacting", on: true },
    { n: 2, l: "Calls", on: true, you: true },
    { n: 1, l: "Quotes", on: true, you: true },
    { n: 1, l: "Bidding", on: true, you: true },
    { n: 0, l: "Submitted", on: false },
  ];
  return (
    <div className="mb-5 flex justify-between gap-2 border-b border-white/10 px-6 pb-4 pt-4">
      {stages.map((s) => (
        <div key={s.l} className="flex flex-1 flex-col items-center text-center">
          <span
            className={`flex h-10 w-10 items-center justify-center rounded-full border-2 text-sm font-semibold ${
              s.on
                ? s.you
                  ? "border-review bg-review text-white"
                  : "border-pursue bg-pursue text-white"
                : "border-white/15 text-muted-foreground"
            }`}
          >
            {s.n}
          </span>
          <span className="mt-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {s.l}
          </span>
        </div>
      ))}
    </div>
  );
}

function Row({
  n,
  label,
  title,
  meta,
  cta,
  focus,
}: {
  n: string;
  label: string;
  title: string;
  meta: string;
  cta: string;
  focus?: boolean;
}) {
  return (
    <div
      className={`mx-6 grid grid-cols-[40px_1fr_auto] items-center gap-4 border-b border-white/10 py-4 ${
        focus ? "bg-gold/10 outline outline-1 outline-gold/40" : ""
      }`}
    >
      <span className="font-mono text-xs text-gold">{n}</span>
      <div>
        <p className="text-[10px] uppercase tracking-[0.14em] text-gold">{label}</p>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{meta}</p>
      </div>
      <button type="button" className="btn-primary text-xs">
        {cta}
      </button>
    </div>
  );
}

function ShotToday() {
  return (
    <Shell active="today">
      <PageHeader title="Today" status="3 decisions. 18 minutes." subtitle="Work the queue in order. Each row opens the exact place to finish the task." />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Rail />
        <p className="px-6 text-[10px] uppercase tracking-[0.14em] text-gold">Needs your attention</p>
        <Row n="01" label="Decision needed" title="HVAC maintenance, Boise VA" meta="Score 84 · Due in 12 days · $1.2M" cta="Review" focus />
        <Row n="02" label="Call when email is not enough" title="Electrical quote still outstanding" meta="Valley Electric · last contact 3 days ago" cta="Call" />
        <Row n="03" label="Final review" title="Grounds maintenance IDIQ" meta="Package complete · submit tomorrow" cta="Review" />
        <p className="px-6 pt-4 text-sm text-muted-foreground">12 tasks handled automatically today</p>
        <Callout text="Only the work that needs a person" x="58%" y="38%" />
      </div>
    </Shell>
  );
}

function ShotPipeline() {
  const cards = {
    you: [
      { title: "Electrical quote, Boise VA", score: 84, value: "$1.2M", due: "12d left", action: "Call Valley Electric" },
      { title: "Grounds maintenance IDIQ", score: 91, value: "$640K", due: "1d left", action: "Review package" },
    ],
    system: [
      { title: "Pocatello janitorial", score: 77, value: "$180K", due: "Scoring", action: "Brost Co working" },
      { title: "Idaho Falls electrical", score: 71, value: "$95K", due: "Finding subs", action: "Brost Co working" },
    ],
    waiting: [{ title: "Mountain Home HVAC", score: 88, value: "$410K", due: "Awaiting reply", action: "3 emails out" }],
    decided: [],
  };
  const lanes = [
    { key: "you", label: "Needs you", blurb: "Decisions, calls, quotes, and sign-offs only a person can do.", items: cards.you, tone: "review" },
    { key: "system", label: "Brost Co is working", blurb: "Scoring, analysis, and research running on their own.", items: cards.system, tone: "pursue" },
    { key: "waiting", label: "Waiting on others", blurb: "Subcontractor replies and agency award decisions.", items: cards.waiting, tone: "muted" },
    { key: "decided", label: "Recently decided", blurb: "Won and lost. Wins move on to Contracts.", items: cards.decided, tone: "muted" },
  ] as const;
  return (
    <Shell active="opps">
      <PageHeader title="Opportunities" status="24 open · scored against your profile" subtitle="Grouped by whose turn it is. Start with Needs you." />
      <div className="relative grid min-h-0 flex-1 grid-cols-4 gap-3 overflow-hidden p-5">
        {lanes.map((lane) => (
          <div key={lane.key} className="flex flex-col rounded-md border border-white/10 bg-surface/40 p-3">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-display text-lg">{lane.label}</h2>
              <span className="num text-gold">{lane.items.length}</span>
            </div>
            <p className="mb-3 text-[11px] leading-snug text-muted-foreground">{lane.blurb}</p>
            <div className="space-y-2">
              {lane.items.map((c, i) => (
                <div
                  key={c.title}
                  className={`rounded-md border border-white/10 bg-background p-3 ${
                    lane.key === "you" && i === 0 ? "outline outline-1 outline-gold/45" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium leading-snug">{c.title}</p>
                    <ScoreBadge score={c.score} />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {c.value} · {c.due}
                  </p>
                  <p className="mt-1 text-[11px] text-gold">{c.action}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
        <Callout text="Strong fits move forward on their own" x="38%" y="28%" />
      </div>
    </Shell>
  );
}

function ShotOpportunity() {
  return (
    <Shell active="opps">
      <PageHeader
        eyebrow="Opportunity · IFB 36C10B26Q0124"
        title="HVAC maintenance, Boise VA"
        status="Service contract · Due Aug 24, 2026"
      />
      <div className="relative min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="mb-5 flex items-start justify-between gap-6">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gold">Set-aside</p>
              <p className="mt-1 font-medium">SDVOSB</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gold">Estimate</p>
              <p className="mt-1 font-medium">$1.2M</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gold">NAICS</p>
              <p className="mt-1 font-medium">238220</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-[0.14em] text-gold">Agency</p>
              <p className="mt-1 font-medium">Department of Veterans Affairs</p>
            </div>
          </div>
          <ScoreBadge score={84} variant="box" />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-md border border-l-4 border-pursue/40 border-l-pursue bg-pursue-soft px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl">Next step</h2>
              <span className="badge bg-pursue/15 text-pursue">Action required</span>
            </div>
            <p className="mt-1 font-semibold">Pursue or pass. Brost Co already scored this as a strong fit.</p>
            <p className="mt-1 text-sm text-muted-foreground">What happens next: outreach starts the moment you pursue.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-success text-xs">
              Pursue
            </button>
            <button type="button" className="btn-danger text-xs">
              Dismiss
            </button>
          </div>
        </div>
        <Callout text="You keep the judgment call" x="52%" y="58%" />
      </div>
    </Shell>
  );
}

function ShotAttention() {
  return (
    <Shell active="opps">
      <PageHeader title="HVAC maintenance, Boise VA" status="Pursued · contacting trades" />
      <div className="relative min-h-0 flex-1 space-y-4 overflow-hidden px-6 py-5">
        <div className="rounded-md border border-white/10 bg-surface px-5 py-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-xl">Bid readiness</h2>
              <p className="font-display text-4xl text-gold">64%</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Not ready · 3 remaining</p>
            </div>
            <p className="max-w-xl text-sm text-muted-foreground">
              Solicitation is read. HVAC and controls quotes are in. Electrical is still open.
            </p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-md border border-white/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-pursue">Complete</p>
              <p className="mt-2 text-sm">Solicitation brief</p>
              <p className="text-sm">HVAC quote</p>
              <p className="text-sm">Controls quote</p>
            </div>
            <div className="rounded-md border border-review/40 bg-review/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-review">Action required</p>
              <p className="mt-2 text-sm">Call Valley Electric</p>
              <p className="text-sm">Review past performance</p>
            </div>
            <div className="rounded-md border border-white/10 p-3">
              <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">Blocked</p>
              <p className="mt-2 text-sm text-muted-foreground">None</p>
            </div>
          </div>
        </div>
        <div className="rounded-md border border-review/50 bg-review/10 px-5 py-4 outline outline-1 outline-gold/30">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl">What needs your attention</h2>
            <span className="badge bg-review/20 text-review">2</span>
          </div>
          <p className="mt-2 text-sm">Electrical quote missing · call Valley Electric</p>
          <p className="text-sm">Past performance narrative needs your review</p>
        </div>
        <Callout text="Attention is a list, not a scavenger hunt" x="54%" y="62%" />
      </div>
    </Shell>
  );
}

function ShotCoverage() {
  const trades = [
    { t: "HVAC", s: "Quote received", d: "Boise Climate Co · $186,400", ok: true },
    { t: "Controls", s: "Quote received", d: "Treasure Valley Controls · $41,200", ok: true },
    { t: "Electrical", s: "Follow-up due", d: "Valley Electric · emailed 3 days ago", ok: false },
    { t: "Test and balance", s: "Quote received", d: "Idaho TAB · $12,800", ok: true },
  ];
  return (
    <Shell active="opps">
      <PageHeader title="Required pricing" subtitle="Every required trade must reach Quote received before submission." />
      <div className="relative min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="mb-4 flex flex-wrap gap-6 text-sm text-muted-foreground">
          <span>
            Found <b className="text-foreground">11</b>
          </span>
          <span>
            Contacted <b className="text-foreground">9</b>
          </span>
          <span>
            Quotes <b className="text-foreground">3</b>
          </span>
          <span className="text-gold">
            Trades needing quotes <b>1</b>
          </span>
        </div>
        <div className="divide-y divide-white/10 rounded-md border border-white/10">
          {trades.map((row) => (
            <div
              key={row.t}
              className={`grid grid-cols-[180px_180px_1fr] items-center gap-4 px-4 py-3 ${
                !row.ok ? "bg-gold/10 outline outline-1 outline-gold/40" : ""
              }`}
            >
              <p className="font-medium">{row.t}</p>
              <p className={row.ok ? "text-pursue" : "text-gold"}>{row.s}</p>
              <p className="text-sm text-muted-foreground">{row.d}</p>
            </div>
          ))}
        </div>
        <Callout text="Brost Co found the trades. One still needs you." x="48%" y="58%" />
      </div>
    </Shell>
  );
}

function ShotCall() {
  return (
    <Shell active="calls">
      <PageHeader title="Call Queue" status="2 calls · soonest deadline first" subtitle="Open a card to start the guided call workspace." />
      <div className="relative min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="max-w-3xl rounded-md border border-gold/40 bg-surface px-6 py-5 outline outline-1 outline-gold/30">
          <p className="text-[10px] uppercase tracking-[0.14em] text-gold">Now calling</p>
          <h2 className="mt-1 font-display text-3xl">Valley Electric</h2>
          <p className="mt-1 text-sm text-muted-foreground">Estimator Dana Ruiz · 208-555-0144 · Boise, ID</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-foreground">
            We need a firm electrical quote for Boise VA HVAC, IFB 36C. Scope is panel work,
            disconnects, and controls power on buildings 12 and 14. Deadline is August 24.
          </p>
          <div className="mt-5 flex gap-2">
            <button type="button" className="btn-success text-xs">
              Log quote
            </button>
            <button type="button" className="btn-ghost text-xs">
              Skip
            </button>
          </div>
        </div>
        <div className="mt-4 flex gap-6 text-xs text-muted-foreground">
          <span>Email sent · Aug 8</span>
          <span>Follow-up sent · Aug 10</span>
          <span className="text-gold">No reply · queued for you</span>
        </div>
        <Callout text="The script is ready. You make the call." x="58%" y="22%" />
      </div>
    </Shell>
  );
}

function ShotQuotes() {
  const rows = [
    ["Boise Climate Co", "HVAC", "$186,400", "In"],
    ["Treasure Valley Controls", "Controls", "$41,200", "In"],
    ["Idaho TAB", "Test and balance", "$12,800", "In"],
    ["Valley Electric", "Electrical", "Pending", "Needed"],
  ];
  return (
    <Shell active="opps">
      <PageHeader title="Quotes" status="3 of 4 trades priced" />
      <div className="relative min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="overflow-hidden rounded-md border border-white/10">
          <div className="grid grid-cols-[1.4fr_.9fr_.8fr_.6fr] gap-3 border-b border-white/10 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-gold">
            <span>Company</span>
            <span>Trade</span>
            <span>Amount</span>
            <span>Status</span>
          </div>
          {rows.map((r, i) => (
            <div
              key={r[0]}
              className={`grid grid-cols-[1.4fr_.9fr_.8fr_.6fr] items-center gap-3 border-b border-white/10 px-4 py-3 ${
                i === 3 ? "bg-gold/10 outline outline-1 outline-gold/40" : ""
              }`}
            >
              <p className="font-medium">{r[0]}</p>
              <p className="text-sm text-muted-foreground">{r[1]}</p>
              <p className="num font-semibold">{r[2]}</p>
              <p className={r[3] === "In" ? "text-pursue" : "text-gold"}>{r[3]}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Coverage is blocked on one trade. Brost Co keeps chasing it until you close it.
        </p>
        <Callout text="Quotes live in one place" x="60%" y="58%" />
      </div>
    </Shell>
  );
}

function ShotPackage() {
  return (
    <Shell active="opps">
      <PageHeader title="Bid package" status="Assembled · compliance checks passed" />
      <div className="relative grid min-h-0 flex-1 grid-cols-[1.3fr_.7fr] gap-6 overflow-hidden px-6 py-5">
        <ul className="space-y-0 text-sm">
          {[
            ["Pricing rollup complete", true],
            ["Certifications attached from your profile", true],
            ["Solicitation attachments indexed", true],
            ["Compliance matrix 18 of 18 included", true],
            ["Signature pages need your review", false],
          ].map(([label, ok]) => (
            <li
              key={String(label)}
              className={`border-b border-white/10 py-3 ${
                ok ? "" : "bg-gold/10 outline outline-1 outline-gold/40"
              }`}
            >
              <span className={ok ? "text-pursue" : "text-gold"}>{ok ? "✓" : "△"}</span> {label}
            </li>
          ))}
        </ul>
        <div className="flex flex-col items-center justify-center border border-gold/40 bg-surface p-8 text-center">
          <p className="font-display text-4xl">IFB 36C</p>
          <p className="mt-2 text-xs uppercase tracking-[0.14em] text-gold">Ready for final approval</p>
        </div>
        <Callout text="You only sign what a person must sign" x="18%" y="62%" />
      </div>
    </Shell>
  );
}

function ShotSubmit() {
  return (
    <Shell active="opps">
      <PageHeader title="Final review" status="Nothing leaves until you say so" />
      <div className="relative min-h-0 flex-1 overflow-hidden px-6 py-5">
        <div className="max-w-2xl rounded-md border border-gold/40 bg-surface px-6 py-6">
          <h2 className="font-display text-2xl">Submit through the agency channel</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Package is complete. Brost Co will not send this to SAM.gov or the contracting
            officer. You submit, then mark it sent here.
          </p>
          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-[10px] uppercase tracking-[0.14em] text-gold">Method</dt>
              <dd className="mt-1">Email to contracting officer</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-[0.14em] text-gold">Deadline</dt>
              <dd className="mt-1">24 Aug · 2:00 PM MT</dd>
            </div>
          </dl>
          <button type="button" className="btn-success mt-6 text-xs">
            Mark submitted
          </button>
        </div>
        <Callout text="Final control stays with you" x="52%" y="58%" />
      </div>
    </Shell>
  );
}

function ShotTodayClose() {
  return (
    <Shell active="today">
      <PageHeader title="Today" status="The machine already ran. You have two moves." />
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <Rail />
        <Row n="01" label="Call when a person is needed" title="Valley Electric still has no quote" meta="Script ready · 4 minutes" cta="Call" focus />
        <Row n="02" label="Final review" title="Grounds maintenance IDIQ" meta="Package complete · due tomorrow" cta="Review" />
        <p className="px-6 pt-4 text-sm text-muted-foreground">
          Outreach, scoring, and follow-up already happened overnight.
        </p>
        <Callout text="Open one list. Act. Done." x="56%" y="40%" />
      </div>
    </Shell>
  );
}

const SHOTS: Record<string, () => ReactElement> = {
  today: ShotToday,
  pipeline: ShotPipeline,
  opportunity: ShotOpportunity,
  attention: ShotAttention,
  coverage: ShotCoverage,
  call: ShotCall,
  quotes: ShotQuotes,
  package: ShotPackage,
  submit: ShotSubmit,
  close: ShotTodayClose,
};

export const FILM_SHOT_IDS = Object.keys(SHOTS);

export function FilmCapture({ shot }: { shot: string }) {
  useEffect(() => {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  const Frame = SHOTS[shot] ?? ShotToday;
  return <Frame />;
}
