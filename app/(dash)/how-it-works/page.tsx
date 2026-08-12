import Link from "next/link";
import { PageHeader } from "@/components/badges";
import { PAGE_HELP } from "@/lib/help-content";

// Must stay dynamic: this route lives under the auth dash layout, which reads
// the session cookie. force-static made cookies unavailable and bounced every
// visit through /login → /today.
export const dynamic = "force-dynamic";

/**
 * The whole Brost Co journey on one screen. Steps must stay aligned with
 * JOURNEY_STAGES + the human touchpoints (setup, review, calls, quotes,
 * submit, outcome) so operators never wonder what happens between stages.
 */

interface Step {
  n: number;
  name: string;
  what: string;
  /** What the system or Admin does next once this step finishes. */
  next?: string;
  who: "auto" | "you" | "subs" | "agency";
  href?: string;
  hrefLabel?: string;
}

interface Phase {
  eyebrow: string;
  title: string;
  blurb: string;
  steps: Step[];
}

const WHO_LABEL: Record<Step["who"], string> = {
  auto: "automatic",
  you: "needs you",
  subs: "waiting on subs",
  agency: "waiting on agency",
};

const WHO_BADGE: Record<Step["who"], string> = {
  auto: "bg-foreground/10 text-foreground",
  you: "bg-pursue/10 text-pursue",
  subs: "bg-review/15 text-review",
  agency: "bg-accent/10 text-accent-strong",
};

const WHO_DOT: Record<Step["who"], string> = {
  auto: "border-foreground bg-foreground text-background",
  you: "border-pursue bg-pursue text-white",
  subs: "border-review bg-review/15 text-review",
  agency: "border-accent bg-accent/10 text-accent-strong",
};

const PHASES: Phase[] = [
  {
    eyebrow: "Before day one",
    title: "Finish setting up",
    blurb:
      "Brost Co can only score, email, and build bids after a few one-time connections are in place. Today shows what is still missing until setup is complete.",
    steps: [
      {
        n: 1,
        name: "Company profile & registrations",
        who: "you",
        href: "/settings/profile",
        hrefLabel: "Open company profile",
        what: "Enter your legal company details, industry codes (NAICS), trades, service areas, certifications, target margin, and your UEI and CAGE from SAM.gov. Scoring and eligibility checks use this as the source of truth.",
        next: "Once identity and scope are saved, Brost Co knows which opportunities fit you.",
      },
      {
        n: 2,
        name: "Connect email and other tools",
        who: "you",
        href: "/settings/integrations",
        hrefLabel: "Open integrations",
        what: "Connect email (Gmail or Resend) so subcontractor outreach can send. Add optional keys for Google Places (finding local subs), SAM.gov, and SMS alerts as needed. Today’s Finish Setting Up checklist tracks what is still open.",
        next: "With email connected, outreach and follow-ups can run without you copying messages by hand.",
      },
    ],
  },
  {
    eyebrow: "Phase one",
    title: "Find the right work",
    blurb:
      "Brost Co watches federal postings and only asks you to decide when a score is borderline.",
    steps: [
      {
        n: 3,
        name: "Find opportunities",
        who: "auto",
        what: "About every 2 hours, new federal opportunities that match your industry codes are pulled from SAM.gov into the pipeline (stage: Found).",
        next: "Each new record moves straight into scoring.",
      },
      {
        n: 4,
        name: "Score every opportunity",
        who: "auto",
        what: "Each opportunity is scored 0–100 against your company profile (fit, geography, size, set-aside, deadline feasibility, risk, and more). Strong fits (Pursue) continue automatically. Borderline fits (Review) wait for you. Poor fits are set aside.",
        next: "Pursue-tier work starts analysis on its own. Review-tier work appears on Today and in the Review Queue.",
      },
      {
        n: 5,
        name: "Decide: pursue or pass",
        who: "you",
        href: "/today",
        hrefLabel: "Open Today",
        what: "Borderline opportunities need your judgment. Decide from Today or the Review Queue, or open the opportunity to read the Bid Brief first. If you do nothing before the timer ends, Brost Co auto-dismisses it so the queue stays clean.",
        next: "Pursue starts analysis, pricing research, and subcontractor sourcing automatically.",
      },
    ],
  },
  {
    eyebrow: "Phase two",
    title: "Understand the job and get pricing",
    blurb:
      "After pursue, Brost Co reads the solicitation, finds subcontractors (including ones you already know), and chases quotes, escalating to you only when a person is needed.",
    steps: [
      {
        n: 6,
        name: "Write the plain-English brief",
        who: "auto",
        what: "The solicitation and attachments are read into a Bid Brief: what the job is, due date, location, required trades, qualifications, forms, and risks. This is the overview on every opportunity page.",
        next: "Required trades feed subcontractor search. Attention items surface on the opportunity and on Today when they need you.",
      },
      {
        n: 7,
        name: "Research pricing comps",
        who: "auto",
        what: "Brost Co looks up price history for similar work so later quotes can be checked for prices that look unusually high or low.",
        next: "Out-of-range quotes are flagged for your review before submission.",
      },
      {
        n: 8,
        name: "Find subcontractors",
        who: "auto",
        what: "For each required trade, Brost Co first reuses reliable subcontractors already on your roster (same trade and area), then searches for additional local candidates. Contact info is verified. Thin coverage (almost no options for a trade) is flagged for you.",
        next: "Paired subcontractors show on the opportunity under Coverage and Subs, with status and history.",
      },
      {
        n: 9,
        name: "Email subcontractors",
        who: "auto",
        what: "Verified subcontractors are emailed automatically. If there is no reply, a polite follow-up goes out after about 48 hours. Status updates on the opportunity and on each subcontractor’s permanent record (emails sent, last contact, outcome).",
        next: "Replies create prepared call cards. Still-silent subcontractors appear on Today for a human follow-up.",
      },
      {
        n: 10,
        name: "Call when a person is needed",
        who: "you",
        href: "/call-queue",
        hrefLabel: "Open Call Queue",
        what: "Today and the Call Queue list calls to make: interested replies first, then follow-ups when email did not get a quote. Each card opens a guided workspace with a script, job details, and a form that saves the conversation and price in one step. You can also skip a call and that choice is recorded.",
        next: "Saving a quote immediately moves pricing forward. Skipped or completed calls update the subcontractor history everywhere.",
      },
      {
        n: 11,
        name: "Enter subcontractor quotes",
        who: "you",
        href: "/today",
        hrefLabel: "See quote work on Today",
        what: "Enter each trade’s price on the opportunity (or capture it from the call workspace). Brost Co tracks which trades still need coverage. Quotes outside the expected range ask for a quick review.",
        next: "When enough pricing is in, Bid Builder prices the job and assembles the package automatically.",
      },
    ],
  },
  {
    eyebrow: "Phase three",
    title: "Assemble, check, and submit",
    blurb:
      "Brost Co builds and audits the package. You review, finish anything only a person can do, and submit.",
    steps: [
      {
        n: 12,
        name: "Price and assemble the bid",
        who: "auto",
        what: "Quotes are rolled up to your target margin and the submission package is assembled: cover letter, pricing, prefilled reps and certs, capability statement, amendment acknowledgments, and files named and ordered for submission.",
        next: "The package appears on the opportunity for your review, with a compliance checklist.",
      },
      {
        n: 13,
        name: "Run compliance checks",
        who: "auto",
        what: "Two independent checks run: an eligibility gate (set-aside, NAICS, bonding, SAM status) and an audit that re-reads the solicitation for anything missing. Required agency forms are flagged so you use the real form, never a substitute. Submission stays blocked until checks pass.",
        next: "Anything still needing a person (signatures, attestations, uploads) is listed clearly on the opportunity.",
      },
      {
        n: 14,
        name: "Review and submit",
        who: "you",
        what: "Open the opportunity’s bid package. Clear the remaining human items, give the checklist a final glance against the solicitation, then submit. Deadlines and blockers stay visible on Today until you finish.",
        next: "After submit, Brost Co waits with you for the agency’s decision.",
      },
      {
        n: 15,
        name: "Wait for the agency",
        who: "agency",
        what: "The opportunity sits in Submitted while the government evaluates bids. Nothing else is required from you until a decision is announced. Brost Co keeps it on Today under awaiting a decision.",
        next: "When you hear the result, record it in one step.",
      },
      {
        n: 16,
        name: "Record win or loss",
        who: "you",
        href: "/contracts",
        hrefLabel: "Open contracts",
        what: "Record the outcome on the opportunity. A win creates the contract record with milestones and compliance tracking. A loss (and every win) teaches the scoring system so future Pursue / Review decisions get sharper.",
        next: "Won work is managed on Contracts. Scoring weight suggestions may appear on Today for your approval.",
      },
    ],
  },
];

function StepRow({ step, last }: { step: Step; last: boolean }) {
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute left-[17px] top-9 h-full w-px bg-border"
        />
      )}
      <span
        className={`num relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${WHO_DOT[step.who]}`}
      >
        {step.n}
      </span>
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-display text-lg font-semibold text-foreground">
            {step.name}
          </h3>
          <span className={`badge ${WHO_BADGE[step.who]}`}>{WHO_LABEL[step.who]}</span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{step.what}</p>
        {step.next && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Then: </span>
            {step.next}
          </p>
        )}
        {step.href && (
          <Link
            href={step.href}
            className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
          >
            {step.hrefLabel ?? "Go there"} →
          </Link>
        )}
      </div>
    </li>
  );
}

export default function HowItWorksPage() {
  const totalSteps = PHASES.reduce((n, p) => n + p.steps.length, 0);

  return (
    <div className="flex page-shell">
      <PageHeader
        help={PAGE_HELP["how-it-works"]}
        title="How it works"
        status={`${totalSteps} steps · 4 phases`}
        subtitle="Brost Co runs the automatic steps. Today lists only what needs you."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">How to use this page</p>
            <p className="mt-1 leading-relaxed">
              Brost Co runs the automatic steps. Day to day, start on{" "}
              <Link href="/today" className="font-medium text-accent hover:underline">
                Today
              </Link>
              . It lists only what needs you (decisions, calls, quote reviews,
              deadlines, renewals). Each opportunity also shows its own journey
              bar, what needs attention, subcontractor coverage, and the single
              recommended next step.
            </p>
          </div>

          {/* Legend */}
          <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-foreground bg-foreground text-[0.6rem] font-semibold text-background">
                #
              </span>
              runs on its own
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-pursue text-[0.6rem] font-semibold text-white">
                #
              </span>
              needs you
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-review bg-review/15 text-[0.6rem] font-semibold text-review">
                #
              </span>
              waiting on subcontractors
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-accent bg-accent/10 text-[0.6rem] font-semibold text-accent-strong">
                #
              </span>
              waiting on the agency
            </span>
          </div>

          <div className="space-y-10">
            {PHASES.map((phase) => (
              <section key={phase.title}>
                <div className="mb-3 border-b-2 border-accent/80 pb-2">
                  <p className="eyebrow">{phase.eyebrow}</p>
                  <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
                    {phase.title}
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    {phase.blurb}
                  </p>
                </div>
                <ol className="relative">
                  {phase.steps.map((step, i) => (
                    <StepRow
                      key={step.n}
                      step={step}
                      last={i === phase.steps.length - 1}
                    />
                  ))}
                </ol>
              </section>
            ))}
          </div>

          {/* Ongoing work outside the happy path */}
          <section className="mt-10">
            <div className="mb-3 border-b-2 border-accent/80 pb-2">
              <p className="eyebrow">Always on</p>
              <h2 className="mt-0.5 font-display text-2xl font-semibold text-foreground">
                Work that keeps running in the background
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                These are not stages on a single bid. They keep the whole
                operation healthy while opportunities move through the pipeline.
              </p>
            </div>
            <ul className="space-y-4">
              <li className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Today stays current
                  </h3>
                  <span className="badge bg-pursue/10 text-pursue">needs you when relevant</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Deadlines, pursue/pass decisions, calls, subcontractor
                  follow-ups, out-of-range quotes, compliance renewals, and
                  scoring-weight approvals all land on{" "}
                  <Link href="/today" className="font-medium text-accent hover:underline">
                    Today
                  </Link>{" "}
                  so you do not have to open every opportunity to find them.
                </p>
              </li>
              <li className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Stay eligible to bid
                  </h3>
                  <span className="badge bg-foreground/10 text-foreground">automatic + your renewals</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Registrations, certifications, and insurance are checked daily
                  on{" "}
                  <Link
                    href="/compliance"
                    className="font-medium text-accent hover:underline"
                  >
                    Compliance
                  </Link>
                  . Brost Co warns before something lapses; renewing is your job.
                </p>
              </li>
              <li className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Learn from every outcome
                  </h3>
                  <span className="badge bg-foreground/10 text-foreground">automatic</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Wins and losses update subcontractor reliability and may propose
                  scoring-weight changes for your approval, so Pursue / Review
                  decisions improve over time.
                </p>
              </li>
              <li className="rounded-md border border-border px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-base font-semibold text-foreground">
                    Watch the automation when something stalls
                  </h3>
                  <span className="badge bg-foreground/10 text-foreground">when needed</span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Every agent action is logged on{" "}
                  <Link href="/agents" className="font-medium text-accent hover:underline">
                    Automation Log
                  </Link>
                  . If a stage sits too long, the opportunity tells you and links
                  to the responsible run.
                </p>
              </li>
            </ul>
          </section>

          <div className="callout-panel mt-10">
            <p className="text-sm font-medium text-foreground">
              You never have to memorize this sequence.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open{" "}
              <Link href="/today" className="font-medium text-accent hover:underline">
                Today
              </Link>
              , do the human items, and let Brost Co handle the rest. Each
              opportunity page answers: what this is, what stage it is in, what
              needs attention, who was contacted, and what happens next.
            </p>
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              One honest note on bid packages
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Brost Co assembles, prefills, and validates the package, and runs
              an independent audit against the solicitation, so your job shrinks
              to reviewing and signing. It gets you very close, but it is not a
              guarantee of perfect compliance: requirements are read by AI, and
              some agencies require their exact forms or portal. Before you
              submit a real bid, give the compliance checklist a final glance
              against the actual solicitation. The tools make that a short check,
              not hours of work.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
