import Link from "next/link";
import { PageHeader } from "@/components/badges";

export const dynamic = "force-static";

/**
 * The whole journey on one screen, grouped into three phases. Clean numbered
 * steps (no icons); the human steps are filled green so they stand out from the
 * ones that run on their own. The per-page "?" popovers handle details in context.
 */

interface Step {
  n: number;
  name: string;
  what: string;
  who: "auto" | "you";
  href?: string;
}

interface Phase {
  eyebrow: string;
  title: string;
  steps: Step[];
}

const PHASES: Phase[] = [
  {
    eyebrow: "Phase one",
    title: "Find the work",
    steps: [
      {
        n: 1,
        name: "Find",
        who: "auto",
        what: "Every 2 hours, new federal opportunities matching your industry codes are pulled in from SAM.gov.",
      },
      {
        n: 2,
        name: "Score",
        who: "auto",
        what: "Each one is scored 0 to 100 against your company profile. Strong fits proceed on their own, borderline ones wait for you, and poor fits are set aside.",
      },
      {
        n: 3,
        name: "Decide",
        who: "you",
        href: "/review",
        what: "Borderline opportunities land in the Review Queue for a quick pursue-or-pass call.",
      },
    ],
  },
  {
    eyebrow: "Phase two",
    title: "Build the bid",
    steps: [
      {
        n: 4,
        name: "Understand",
        who: "auto",
        what: "For pursued work, the solicitation and its attachments are read into a plain-English brief and a compliance checklist: every form, schedule, certification, and attachment the bid must include, plus price history for similar jobs.",
      },
      {
        n: 5,
        name: "Find subs",
        who: "auto",
        what: "Local subcontractors are found for each trade, checked against the federal exclusion list, and emailed automatically, with a 48-hour follow-up.",
      },
      {
        n: 6,
        name: "Call",
        who: "you",
        href: "/call-queue",
        what: "Interested subs become call cards. A guided workspace walks you through each call and captures their price.",
      },
      {
        n: 7,
        name: "Price and assemble",
        who: "auto",
        what: "When quotes are in, the bid is priced to your target margin and the full submission package is assembled: cover letter, pricing schedule, prefilled reps and certs, capability statement, amendment acknowledgments, every file named and ordered for submission.",
      },
      {
        n: 8,
        name: "Check compliance",
        who: "auto",
        what: "Two independent checks run: an eligibility gate (are you actually qualified: set-aside, NAICS, bonding, SAM) and an adversarial audit that re-reads the solicitation to catch anything missing. Required agency forms are flagged to use the real form, never a substitute.",
      },
    ],
  },
  {
    eyebrow: "Phase three",
    title: "Win the contract",
    steps: [
      {
        n: 9,
        name: "Review and sign",
        who: "you",
        what: "You get a package that is assembled and validated. Clear the items only a person can do (signatures, the reps and certs attestation, anything you must provide), then submit. Submission is blocked until the compliance checks pass.",
      },
      {
        n: 10,
        name: "Win or learn",
        who: "you",
        what: "Record the result. A win sets up the contract with milestones and compliance tracking, and every result teaches the scoring system to pick better next time.",
      },
    ],
  },
];

function StepRow({ step, last }: { step: Step; last: boolean }) {
  const isYou = step.who === "you";
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute left-[17px] top-9 h-full w-px bg-border"
        />
      )}
      <span
        className={`num relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ${
          isYou
            ? "border-accent bg-accent text-white"
            : "border-border bg-background text-slate-400"
        }`}
      >
        {step.n}
      </span>
      <div className="min-w-0 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-serif text-lg font-semibold text-foreground">
            {step.name}
          </h3>
          <span
            className={`badge ${
              isYou ? "bg-accent/10 text-accent" : "bg-slate-200 text-slate-600"
            }`}
          >
            {isYou ? "needs you" : "automatic"}
          </span>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{step.what}</p>
        {step.href && (
          <Link
            href={step.href}
            className="mt-1.5 inline-block text-xs font-medium text-accent hover:underline"
          >
            Go there →
          </Link>
        )}
      </div>
    </li>
  );
}

export default function HowItWorksPage() {
  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="How it works"
        subtitle="From a government posting to a won contract. Most steps run on their own; a few need you."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-2xl">
          {/* Legend */}
          <div className="mb-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-[0.6rem] font-semibold text-slate-400">
                #
              </span>
              runs on its own
            </span>
            <span className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[0.6rem] font-semibold text-white">
                #
              </span>
              waits for your decision
            </span>
          </div>

          {/* Phases */}
          <div className="space-y-10">
            {PHASES.map((phase) => (
              <section key={phase.title}>
                <div className="mb-5 border-b-2 border-accent/80 pb-2">
                  <p className="eyebrow">{phase.eyebrow}</p>
                  <h2 className="mt-0.5 font-serif text-2xl font-semibold text-foreground">
                    {phase.title}
                  </h2>
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

          {/* Closing */}
          <div className="callout-panel mt-10">
            <p className="text-sm font-medium text-foreground">
              You never have to remember any of this.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              The{" "}
              <Link href="/today" className="font-medium text-accent hover:underline">
                Today page
              </Link>{" "}
              always lists exactly what needs you, most urgent first, and every
              opportunity shows its own recommended next step. The small ? next to
              each page title explains that page in a few lines.
            </p>
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              One honest note on bid packages
            </p>
            <p className="mt-1 text-sm text-slate-600">
              The system assembles, prefills, and validates the package, and runs
              an independent audit against the solicitation, so your job shrinks to
              reviewing and signing. It gets you very close, but it isn&rsquo;t a
              guarantee of perfect compliance: the requirements are read by AI, and
              some agencies require their exact forms or portal. Before you submit a
              real bid, give the compliance checklist a final glance against the
              actual solicitation. The tools make that a short check, not hours of
              work.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
