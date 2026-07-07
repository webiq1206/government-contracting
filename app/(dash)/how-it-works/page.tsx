import Link from "next/link";
import { PageHeader } from "@/components/badges";

export const dynamic = "force-static";

/**
 * The whole journey on one screen: nine steps, one sentence each, with a
 * clear "automatic vs needs you" marker. Deliberately visual and skimmable;
 * the per-page "?" popovers handle the details in context.
 */

interface Step {
  icon: string;
  name: string;
  what: string;
  who: "auto" | "you";
  href?: string;
}

const STEPS: Step[] = [
  {
    icon: "📡",
    name: "Find",
    what: "Every 2 hours, new federal opportunities matching your industry codes are pulled in from SAM.gov.",
    who: "auto",
  },
  {
    icon: "🎯",
    name: "Score",
    what: "Each one is scored 0-100 against your company profile. High scores proceed on their own; borderline ones wait for you; poor fits are dismissed.",
    who: "auto",
  },
  {
    icon: "⚖️",
    name: "Decide",
    what: "Borderline opportunities land in the Review Queue for a quick pursue-or-pass call.",
    who: "you",
    href: "/review",
  },
  {
    icon: "📖",
    name: "Understand",
    what: "For pursued work, the solicitation and its attachments are read into a plain-English brief AND a compliance matrix: every form, schedule, certification, and attachment the bid must include, plus price history for similar jobs.",
    who: "auto",
  },
  {
    icon: "🔍",
    name: "Find subs",
    what: "Local subcontractors are found for each trade, checked against the federal exclusion list, and emailed automatically (with a 48-hour follow-up).",
    who: "auto",
  },
  {
    icon: "📞",
    name: "Call",
    what: "Interested subs become call cards. A guided workspace walks you through each call and captures their price.",
    who: "you",
    href: "/call-queue",
  },
  {
    icon: "🧮",
    name: "Price & assemble",
    what: "When quotes are in, the bid is priced to your target margin and the full submission package is assembled: cover letter, pricing schedule, prefilled reps & certs, capability statement, amendment acknowledgments, and every file named and ordered for submission.",
    who: "auto",
  },
  {
    icon: "🛡️",
    name: "Check compliance",
    what: "Two independent checks run: an eligibility gate (are you actually qualified, set-aside, NAICS, bonding, SAM) and an adversarial audit that re-reads the solicitation to catch anything missing or non-compliant. Required agency forms are flagged to use the real form, never a substitute.",
    who: "auto",
  },
  {
    icon: "✍️",
    name: "Review & sign",
    what: "You get a package that's assembled and validated. Clear the items only a person can do, signatures, the reps & certs attestation, anything you must provide, then submit. Submission is blocked until the compliance checks pass.",
    who: "you",
  },
  {
    icon: "🏁",
    name: "Win or learn",
    what: "Record the result. A win sets up the contract with milestones and compliance tracking; every result teaches the scoring system to pick better next time.",
    who: "you",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="How it works"
        subtitle="Ten steps from a government posting to a won contract. Most run on their own; a few need you."
      />
      <div className="scroll-thin flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-2xl">
          {/* Legend */}
          <div className="mb-6 flex items-center gap-4 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="badge bg-slate-200 text-slate-600">automatic</span>
              runs on its own
            </span>
            <span className="flex items-center gap-1.5">
              <span className="badge bg-accent/10 text-accent">you</span>
              waits for your decision
            </span>
          </div>

          {/* Steps */}
          <ol className="relative space-y-0">
            {STEPS.map((s, i) => (
              <li key={s.name} className="relative flex gap-4 pb-8 last:pb-0">
                {/* Connector line */}
                {i < STEPS.length - 1 && (
                  <span
                    aria-hidden
                    className="absolute left-[19px] top-10 h-full w-px bg-border"
                  />
                )}
                <span
                  className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-lg ${
                    s.who === "you"
                      ? "border-accent bg-accent-soft"
                      : "border-border bg-surface"
                  }`}
                >
                  {s.icon}
                </span>
                <div className="min-w-0 pt-1">
                  <div className="flex items-center gap-2">
                    <p className="font-serif text-lg font-semibold text-foreground">
                      {i + 1}. {s.name}
                    </p>
                    <span
                      className={`badge ${
                        s.who === "you"
                          ? "bg-accent/10 text-accent"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      {s.who === "you" ? "you" : "automatic"}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {s.what}
                  </p>
                  {s.href && (
                    <Link
                      href={s.href}
                      className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
                    >
                      Go there →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ol>

          {/* Closing */}
          <div className="callout-panel mt-8">
            <p className="text-sm font-medium text-foreground">
              You never have to remember any of this.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              The <Link href="/today" className="font-medium text-accent hover:underline">Today page</Link>{" "}
              always lists exactly what needs you, most urgent first, and every
              opportunity shows its own recommended next step. The small ? next
              to each page title explains that page in a few lines.
            </p>
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              One honest note on bid packages
            </p>
            <p className="mt-1 text-sm text-slate-600">
              The system assembles, prefills, and validates the package, and runs
              an independent audit against the solicitation, so your job shrinks
              to reviewing and signing. It gets you very close, but it isn&rsquo;t
              a guarantee of perfect compliance: the requirements are read by AI,
              and some agencies require their exact forms or portal. Before you
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
