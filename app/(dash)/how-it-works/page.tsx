import Link from "next/link";
import { NextResponse } from "next/server";
import { PageFrame } from "@/components/page-frame";
import { PAGE_HELP } from "@/lib/help-content";
import { requireOrgContext } from "@/lib/org-guard";
import { roleLabel } from "@/lib/domain/roles";
import { getActiveProfile } from "@/lib/ai/companyProfile";
import { getAutomationRules } from "@/lib/app-settings";
import { gmail } from "@/lib/integrations/gmail";
import { accountSetup } from "@/lib/setup-facts";
import { agentSchedules } from "@/lib/agent-cadence";
import { describeCron } from "@/lib/domain/cron-describe";
import { knowledgeFacts } from "@/lib/knowledge-facts";
import { shortDate } from "@/lib/format";
import {
  PHASES,
  WORKFLOW_STEPS,
  OWNER_LABEL,
  OWNER_WHO,
  glossaryList,
  noKnowledgeAdvice,
  quickStart,
  searchKnowledge,
  stepSkipped,
  stepViews,
  type Article,
  type Evidence,
  type EvidenceKey,
  type KnowledgeContext,
  type StepView,
} from "@/lib/domain/knowledge";

// Must stay dynamic: this route lives under the auth dash layout, which reads
// the session cookie. force-static made cookies unavailable and bounced every
// visit through /login to /today. It now also reads this account's own
// records, which is a second reason it can never be cached across tenants.
export const dynamic = "force-dynamic";

const OWNER_BADGE: Record<string, string> = {
  auto: "bg-foreground/10 text-foreground",
  you: "bg-pursue/10 text-pursue",
  subs: "bg-review/15 text-review",
  agency: "bg-accent/10 text-accent-strong",
};

const OWNER_DOT: Record<string, string> = {
  auto: "border-foreground bg-foreground text-background",
  you: "border-pursue bg-pursue text-on-status",
  subs: "border-review bg-review/15 text-review",
  agency: "border-accent bg-accent/10 text-accent-strong",
};

const STATUS_TONE: Record<string, string> = {
  good: "bg-pursue/10 text-pursue",
  attention: "bg-review/15 text-review",
  neutral: "bg-foreground/8 text-muted-foreground",
  unknown: "bg-risk/10 text-risk",
};

/** The per-page help this product already writes, offered here as articles. */
function articlesFromHelp(): Article[] {
  const HREF: Record<string, string> = {
    today: "/today",
    pipeline: "/pipeline",
    review: "/review",
    "call-queue": "/call-queue",
    subs: "/subs",
    contracts: "/contracts",
    compliance: "/compliance",
    analytics: "/analytics",
    authority: "/authority",
    "email-log": "/email-log",
    agents: "/agents",
    profile: "/settings/profile",
    rules: "/settings/rules",
    integrations: "/settings/integrations",
    content: "/settings/content",
    opportunity: "/opportunities",
    "how-it-works": "/how-it-works",
  };
  return Object.entries(PAGE_HELP)
    .filter(([key]) => key !== "how-it-works" && HREF[key])
    .map(([key, help]) => ({
      key,
      title: help.title,
      points: help.points,
      href: HREF[key],
    }));
}

export default async function KnowledgeCenterPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const ctx = await requireOrgContext();
  if (ctx instanceof NextResponse) return ctx;

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (one(searchParams?.q) ?? "").trim();
  const full = one(searchParams?.full) === "1";

  const [profile, rules, facts, inbox] = await Promise.all([
    getActiveProfile().catch(() => null),
    getAutomationRules(),
    knowledgeFacts(),
    gmail
      .connection()
      .catch(() => ({ connected: false, email: null, status: "none", lastError: null })),
  ]);

  // The same checklist Today shows, from the same helper. Two answers to "is
  // setup finished" is one more than the number that can be right.
  const setup = await accountSetup(profile?.profile_json ?? null, ctx.user);

  /*
   * The cadence every scheduled step shows comes from here, which is the same
   * list the worker schedules from. The sentence an operator reads and the
   * expression the scheduler obeys are now one fact with two renderings, so
   * changing the schedule changes the page and forgetting to is not possible.
   */
  const schedules = agentSchedules();

  const thresholds = profile?.profile_json?.decision_thresholds ?? null;

  /*
   * The two setup steps are a condition, not a rate: an inbox is connected,
   * disconnected, or holding a token that has expired, and none of those is a
   * count per week. Only this page can ask the mail integration which it is,
   * so only this page writes those two sentences.
   */
  const profileItems = setup.items.filter((i) => i.href.includes("profile"));
  const profileOutstanding = profileItems.filter((i) => !i.done);
  const evidence: Partial<Record<EvidenceKey, Evidence>> = {
    ...facts.evidence,
    profile: {
      recent: null,
      lastAt: facts.evidence.profile?.lastAt ?? null,
      override:
        profileOutstanding.length === 0
          ? {
              word: "Set up",
              tone: "good",
              detail: `Every profile field the checklist asks for is filled in${
                facts.evidence.profile?.lastAt
                  ? `, last edited ${shortDate(facts.evidence.profile.lastAt)}`
                  : ""
              }.`,
            }
          : {
              word: "Needs you",
              tone: "attention",
              detail: `${profileOutstanding.length} profile ${
                profileOutstanding.length === 1 ? "field is" : "fields are"
              } still blank: ${profileOutstanding.map((i) => i.label).join("; ")}.`,
            },
    },
    inbox: {
      recent: null,
      lastAt: null,
      override: inbox.connected
        ? {
            word: "Set up",
            tone: "good",
            detail: `Outreach sends from ${inbox.email ?? "your connected inbox"}, and replies come back onto the opportunity.`,
          }
        : {
            word: "Needs you",
            tone: "attention",
            detail: inbox.lastError
              ? `No outreach can send. The last attempt to use this inbox failed: ${inbox.lastError}`
              : "No inbox is connected, so no outreach email can be sent from this account.",
          },
    },
  };

  const kctx: KnowledgeContext = {
    schedules,
    rules,
    thresholds: {
      pursueMin: thresholds?.pursue_min_score ?? null,
      reviewMin: thresholds?.review_min_score ?? null,
      autoDismissHours: thresholds?.review_auto_dismiss_hours ?? null,
    },
    evidence,
    now: new Date(),
  };

  const views = stepViews(kctx, describeCron);
  const byKey = new Map(views.map((v) => [v.step.key, v]));
  const articles = articlesFromHelp();
  const hits = q ? searchKnowledge(q, articles) : null;
  const terms = glossaryList();

  function href(over: { q?: string; full?: string | null } = {}): string {
    const p = new URLSearchParams();
    const nextQ = over.q ?? q;
    if (nextQ) p.set("q", nextQ);
    const nextFull = over.full === undefined ? (full ? "1" : "") : (over.full ?? "");
    if (nextFull) p.set("full", nextFull);
    const s = p.toString();
    return s ? `/how-it-works?${s}` : "/how-it-works";
  }

  // Steps, not items: the decide step alone can be holding eight decisions,
  // and "8 waiting on you" in the header beside a page about the workflow
  // reads as eight steps. The per-step detail carries the real counts.
  const needsYou = views.filter((v) => v.status.word === "Waiting on you").length;

  return (
    <div className="flex page-shell">
      <PageFrame
        help={PAGE_HELP["how-it-works"]}
        title="Knowledge Center"
        status={
          needsYou > 0
            ? `${WORKFLOW_STEPS.length} steps · ${needsYou} ${needsYou === 1 ? "step needs" : "steps need"} you`
            : `${WORKFLOW_STEPS.length} steps · ${terms.length} terms`
        }
        explanation="Every step of the workflow, what it is doing on this account right now, and the words a solicitation uses."
        primaryAction={
          <Link href={href({ full: full ? null : "1" })} className="btn-ghost text-xs">
            {full ? "Collapse the detail" : "Full reference"}
          </Link>
        }
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-3xl space-y-8">
          {/* 1. Search, before anything else on the page. */}
          <section aria-labelledby="kb-search">
            <h2 id="kb-search" className="sr-only">
              Search the Knowledge Center
            </h2>
            <form method="get" action="/how-it-works" className="flex flex-wrap items-center gap-2">
              {full && <input type="hidden" name="full" value="1" />}
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Ask in your own words: why did nothing get emailed?"
                aria-label="Search the Knowledge Center"
                className="input min-w-0 flex-1 text-sm"
              />
              <button type="submit" className="btn-primary text-sm">
                Search
              </button>
              {q && (
                <Link href={href({ q: "" })} className="tap text-xs text-slate-500 hover:text-accent">
                  Clear
                </Link>
              )}
            </form>
          </section>

          {hits && (
            <section aria-labelledby="kb-results" className="space-y-3">
              <h2 id="kb-results" className="font-display text-xl font-semibold text-foreground">
                {hits.total === 0
                  ? `Nothing found for "${q}"`
                  : `${hits.total} ${hits.total === 1 ? "result" : "results"} for "${q}"`}
              </h2>
              {/* Never present a partial match as an answer to the whole
                  question: the reader has to know which half was matched. */}
              {hits.partial && (
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Nothing here uses every word you typed. These share at least one, best
                  match first.
                </p>
              )}
              {hits.total === 0 ? (
                <p className="panel-inset px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                  {noKnowledgeAdvice(q)}
                </p>
              ) : (
                <div className="space-y-4">
                  {hits.steps.length > 0 && (
                    <div>
                      <p className="label">
                        {hits.steps.length === 1 ? "One workflow step" : `${hits.steps.length} workflow steps`}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {hits.steps.map((s) => {
                          const v = byKey.get(s.key);
                          return (
                            <li key={s.key} className="panel-inset px-4 py-2.5">
                              <a
                                href={`#step-${s.key}`}
                                className="text-sm font-medium text-accent hover:underline"
                              >
                                Step {s.n}: {s.name}
                              </a>
                              <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                                {v ? v.status.detail : s.what}
                              </p>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {hits.terms.length > 0 && (
                    <div>
                      <p className="label">
                        {hits.terms.length === 1 ? "One term" : `${hits.terms.length} terms`}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {hits.terms.map((t) => (
                          <li key={t.key} className="panel-inset px-4 py-2.5">
                            <a
                              href={`#term-${t.key}`}
                              className="text-sm font-medium text-accent hover:underline"
                            >
                              {t.label}
                            </a>
                            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                              {t.text}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {hits.articles.length > 0 && (
                    <div>
                      <p className="label">
                        {hits.articles.length === 1 ? "One page" : `${hits.articles.length} pages`}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {hits.articles.map((a) => (
                          <li key={a.key} className="panel-inset px-4 py-2.5">
                            <Link
                              href={a.href}
                              className="text-sm font-medium text-accent hover:underline"
                            >
                              {a.title}
                            </Link>
                            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                              {a.points[0]}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {/* 2. Where to start, for the role actually reading it. */}
          <QuickStart
            role={ctx.user.orgRole}
            setupItems={setup.items}
            facts={facts.quickStart}
          />

          {/* 3. The workflow map. */}
          <section aria-labelledby="kb-map" className="space-y-8">
            <div>
              <h2 id="kb-map" className="font-display text-2xl font-semibold text-foreground">
                The workflow, end to end
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Every step says who does it, what starts it, what it needs, what it produces,
                and what to do when it does not happen. Cadences and limits are read from this
                account&apos;s own settings, so what you see here is what is actually running.
              </p>
              <Legend />
            </div>

            {PHASES.map((phase) => {
              const steps = views.filter((v) => v.step.phase === phase.key);
              return (
                <section key={phase.key} aria-labelledby={`phase-${phase.key}`}>
                  <div className="mb-3 border-b-2 border-accent/80 pb-2">
                    <p className="eyebrow">{phase.eyebrow}</p>
                    <h3
                      id={`phase-${phase.key}`}
                      className="mt-0.5 font-display text-xl font-semibold text-foreground"
                    >
                      {phase.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                      {phase.blurb}
                    </p>
                  </div>
                  <ol className="relative">
                    {steps.map((v, i) => (
                      <StepRow
                        key={v.step.key}
                        view={v}
                        last={i === steps.length - 1}
                        open={full}
                        skipped={stepSkipped(v.step, rules)}
                      />
                    ))}
                  </ol>
                </section>
              );
            })}
          </section>

          {/* 4. Work that is not a stage on any one bid. */}
          <AlwaysOn />

          {/* 5. The vocabulary, searchable and linkable. */}
          <section aria-labelledby="kb-glossary" className="space-y-3">
            <div className="border-b-2 border-accent/80 pb-2">
              <p className="eyebrow">Reference</p>
              <h2
                id="kb-glossary"
                className="mt-0.5 font-display text-2xl font-semibold text-foreground"
              >
                Glossary
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                {terms.length} terms, the ones a federal solicitation uses and the ones this
                product uses. The same definitions appear as tooltips on the pages that use
                them.
              </p>
            </div>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {terms.map((t) => (
                <div key={t.key} id={`term-${t.key}`} className="panel-inset px-4 py-3">
                  <dt className="text-sm font-semibold text-foreground">{t.label}</dt>
                  <dd className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
                    {t.text}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <div className="callout-panel">
            <p className="text-sm font-medium text-foreground">
              One honest note on bid packages
            </p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Brost Co assembles, prefills, and validates the package, and runs an independent
              audit against the solicitation, so your job shrinks to reviewing and signing. It
              gets you very close, but it is not a guarantee of perfect compliance:
              requirements are read by AI, and some agencies require their exact forms or
              portal. Before you submit a real bid, give the compliance checklist a final
              glance against the actual solicitation. The tools make that a short check, not
              hours of work.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
      {(["auto", "you", "subs", "agency"] as const).map((owner) => (
        <span key={owner} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border text-[0.6rem] font-semibold ${OWNER_DOT[owner]}`}
          >
            #
          </span>
          {OWNER_LABEL[owner]}
        </span>
      ))}
    </div>
  );
}

function StepRow({
  view,
  last,
  open,
  skipped,
}: {
  view: StepView;
  last: boolean;
  open: boolean;
  skipped: boolean;
}) {
  const { step, status } = view;
  return (
    <li id={`step-${step.key}`} className="relative flex scroll-mt-24 gap-4 pb-7 last:pb-0">
      {!last && (
        <span aria-hidden className="absolute left-[17px] top-9 h-full w-px bg-border" />
      )}
      <span
        className={`num relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
          skipped ? "border-border bg-surface text-muted-foreground" : OWNER_DOT[step.owner]
        }`}
      >
        {step.n}
      </span>
      <div className="min-w-0 flex-1 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="font-display text-lg font-semibold text-foreground">{step.name}</h4>
          <span className={`badge ${OWNER_BADGE[step.owner]}`}>{OWNER_LABEL[step.owner]}</span>
        </div>

        {/* What this step is doing on this account, not what it does in general. */}
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={`badge ${STATUS_TONE[status.tone]}`}>{status.word}</span>
          <span className="text-sm leading-relaxed text-muted-foreground">{status.detail}</span>
        </div>

        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.what}</p>

        {view.settingNotes.map((note) => (
          <p key={note.text} className="mt-1.5 text-sm leading-relaxed text-foreground">
            {note.text}{" "}
            <Link href={note.href} className="font-medium text-accent hover:underline">
              Change it
            </Link>
          </p>
        ))}

        <details open={open} className="group mt-2">
          <summary className="tap inline-flex min-h-11 cursor-pointer items-center text-xs font-medium text-accent hover:underline lg:min-h-0">
            How this step works
          </summary>
          <dl className="mt-2 space-y-1.5 border-l-2 border-border pl-3 text-sm">
            <Fact label="Owner">{OWNER_WHO[step.owner]}</Fact>
            <Fact label="Starts">{view.triggerText}</Fact>
            <Fact label="Needs">{step.input}</Fact>
            <Fact label="Produces">{step.output}</Fact>
            {/*
              * Which half is the platform's and which half is yours.
              *
              * "Owner" above is one word, and one word cannot carry this: a
              * step that runs on its own still has a human edge somewhere,
              * and a step that needs you has usually had most of the work
              * done for it already. Somebody waiting on automation that was
              * never going to happen is waiting because nobody said this.
              */}
            <Fact label="Done for you">{step.automatic}</Fact>
            <Fact label="Needs a person">{step.manual}</Fact>
            <Fact label="Then">{step.next}</Fact>
            {step.blockers.length > 0 && (
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  What usually stops it
                </dt>
                <dd className="leading-relaxed text-muted-foreground">
                  <ul className="list-disc space-y-1 pl-4">
                    {step.blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                If it does not happen
              </dt>
              <dd className="leading-relaxed text-muted-foreground">
                {step.recovery}{" "}
                <Link href={step.recoveryHref} className="font-medium text-accent hover:underline">
                  {step.recoveryLabel}
                </Link>
              </dd>
            </div>
          </dl>
        </details>

        {step.href && (
          <Link
            href={step.href}
            /* This is the step's action, not a link inside a sentence, so it
               gets a thumb-sized box rather than the 16px a bare inline-block
               collapses to. */
            className="mt-1.5 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline lg:min-h-0"
          >
            {step.hrefLabel ?? "Go there"} &rarr;
          </Link>
        )}
      </div>
    </li>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="leading-relaxed text-muted-foreground">{children}</dd>
    </div>
  );
}

function QuickStart({
  role,
  setupItems,
  facts,
}: {
  role: string | null | undefined;
  setupItems: { key: string; label: string; hint: string; done: boolean; href: string; required: boolean }[];
  facts: { hasOpportunities: boolean; hasDecided: boolean; hasSubs: boolean };
}) {
  const items = quickStart(role, setupItems, facts, roleLabel);
  const outstanding = items.filter((i) => !i.done);
  return (
    <section aria-labelledby="kb-quickstart" className="space-y-3">
      <div className="border-b-2 border-accent/80 pb-2">
        <p className="eyebrow">Start here</p>
        <h2
          id="kb-quickstart"
          className="mt-0.5 font-display text-2xl font-semibold text-foreground"
        >
          Quick start for {roleLabel(role).toLowerCase()}s
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {outstanding.length === 0
            ? "Every step on this list is done on this account."
            : `${outstanding.length} of ${items.length} still to do. Steps your role cannot perform are listed anyway, with who can.`}
        </p>
      </div>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li
            key={item.key}
            className={`panel-inset px-4 py-3 ${item.done ? "opacity-70" : ""}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                aria-hidden
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[0.65rem] font-semibold ${
                  item.done
                    ? "border-pursue bg-pursue text-on-status"
                    : "border-border text-muted-foreground"
                }`}
              >
                {item.done ? "✓" : ""}
              </span>
              <span className="text-sm font-medium text-foreground">{item.label}</span>
              <span className="sr-only">{item.done ? "Done" : "Still to do"}</span>
              {item.required && !item.done && (
                <span className="badge bg-risk/10 text-risk">nothing runs without it</span>
              )}
            </div>
            <p className="mt-1 pl-7 text-sm leading-relaxed text-muted-foreground">{item.hint}</p>
            {item.blockedBy ? (
              <p className="mt-1 pl-7 text-sm leading-relaxed text-review">{item.blockedBy}</p>
            ) : (
              !item.done && (
                <Link
                  href={item.href}
                  className="ml-7 mt-1 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline lg:min-h-0"
                >
                  {item.hrefLabel} &rarr;
                </Link>
              )
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AlwaysOn() {
  const ITEMS = [
    {
      title: "Today stays current",
      badge: "needs you when relevant",
      tone: "bg-pursue/10 text-pursue",
      href: "/today",
      hrefLabel: "Open Today",
      body: "Deadlines, pursue and pass decisions, calls, subcontractor follow-ups, out-of-range quotes, compliance renewals, and scoring-weight approvals all land on Today, so you do not have to open every opportunity to find them.",
    },
    {
      title: "Stay eligible to bid",
      badge: "automatic, plus your renewals",
      tone: "bg-foreground/10 text-foreground",
      href: "/compliance",
      hrefLabel: "Open Compliance",
      body: "Registrations, certifications, and insurance are checked daily on Compliance. Brost Co warns before something lapses; renewing is your job.",
    },
    {
      title: "Learn from every outcome",
      badge: "automatic",
      tone: "bg-foreground/10 text-foreground",
      href: "/analytics",
      hrefLabel: "Open Analytics",
      body: "Wins and losses update subcontractor reliability and may propose scoring-weight changes for your approval, so pursue and review decisions improve over time.",
    },
    {
      title: "Watch the automation when something stalls",
      badge: "when needed",
      tone: "bg-foreground/10 text-foreground",
      href: "/agents",
      hrefLabel: "Open Automation Health",
      body: "Every agent action is logged on Automation Health, with the last run and its error. If a stage sits too long, the opportunity says so and links to the responsible run.",
    },
  ];
  return (
    <section aria-labelledby="kb-always" className="space-y-3">
      <div className="border-b-2 border-accent/80 pb-2">
        <p className="eyebrow">Always on</p>
        <h2 id="kb-always" className="mt-0.5 font-display text-2xl font-semibold text-foreground">
          Work that keeps running in the background
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          These are not stages on a single bid. They keep the whole operation healthy while
          opportunities move through the pipeline.
        </p>
      </div>
      <ul className="space-y-2">
        {ITEMS.map((item) => (
          <li key={item.title} className="panel-inset px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-base font-semibold text-foreground">
                {item.title}
              </h3>
              <span className={`badge ${item.tone}`}>{item.badge}</span>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            <Link
              href={item.href}
              className="mt-1 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline lg:min-h-0"
            >
              {item.hrefLabel} &rarr;
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
