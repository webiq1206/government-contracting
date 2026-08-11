import Link from "next/link";
import { currency } from "@/lib/format";
import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";
import { PromoCountdown } from "./promo-countdown";

export interface LandingPageProps {
  promoActive: boolean;
  promoEndsAt: string | null;
  standardMonthly: number;
  foundingMonthly: number;
  signupHref: string;
  loginHref?: string;
}

const STEPS = [
  {
    n: 1,
    title: "Set up once",
    body: "Enter your company profile, NAICS codes, trades, service areas, and connect email. Brost Co knows what work fits you before the first posting arrives.",
  },
  {
    n: 2,
    title: "Watch federal postings",
    body: "Matching opportunities from SAM.gov land in your pipeline on a steady schedule. You are not refreshing portals or copying rows into spreadsheets.",
  },
  {
    n: 3,
    title: "Score every record",
    body: "Each posting is scored 0-100 against your profile: fit, geography, set-aside, deadline, and risk. Strong fits move forward. Weak fits are set aside.",
  },
  {
    n: 4,
    title: "Decide on borderline work",
    body: "Review-tier opportunities wait for your judgment on Today. Pursue or pass in one place, with a plain-English brief when you need context.",
  },
  {
    n: 5,
    title: "Source subs and collect quotes",
    body: "Required trades are matched from your roster first, then local candidates. Outreach, follow-ups, and call prep run until pricing is in hand.",
  },
  {
    n: 6,
    title: "Assemble the bid package",
    body: "Quotes roll up to your margin. Cover letter, pricing, reps, certs, and compliance checks are assembled before anything reaches your desk to sign.",
  },
  {
    n: 7,
    title: "Review and submit",
    body: "You give the package a final read, clear human-only items, and submit through the agency channel. Brost Co tracks deadlines until a decision lands.",
  },
] as const;

const FAQ = [
  {
    q: "What is Brost Co?",
    a: "Brost Co is procurement execution software for federal services contractors. It monitors SAM.gov, scores opportunities, writes plain-English briefs, sources subcontractors, assembles bid packages, and keeps one Today queue for everything that still needs a person.",
  },
  {
    q: "Does Brost Co replace SAM.gov?",
    a: "No. SAM.gov remains the official source for federal postings and your entity registration. Brost Co reads from SAM.gov and organizes the work after records arrive. You still renew registrations and submit through agency channels.",
  },
  {
    q: "Does Brost Co submit bids automatically?",
    a: "No. Brost Co assembles and validates bid packages, but submission requires your review and action. Signatures, attestations, and portal uploads stay with you.",
  },
  {
    q: "Who is Brost Co for?",
    a: "Small and mid-size federal services contractors who bid on construction, facilities, or professional services work and need a disciplined pipeline without hiring a full capture team.",
  },
  {
    q: "How much does Brost Co cost?",
    a: "Standard pricing is listed on this page. Founding members who join during the launch window lock in a lower monthly rate for as long as they remain subscribed.",
  },
  {
    q: "Will Brost Co guarantee wins?",
    a: "No. Scoring and automation reduce wasted effort on poor fits and speed up good ones. Outcomes still depend on your pricing, past performance, and the competition.",
  },
  {
    q: "How is this different from a generic CRM?",
    a: "Brost Co is built around the federal bid lifecycle: NAICS fit, set-asides, subcontractor coverage, compliance gates, and SAM.gov intake. Stages, Today, and opportunity pages follow that journey instead of generic deal fields.",
  },
] as const;

function SectionHeading({
  eyebrow,
  title,
  lead,
  id,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  id?: string;
}) {
  return (
    <header id={id} className="scroll-mt-24">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h2>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
        {lead}
      </p>
    </header>
  );
}

export function LandingPage({
  promoActive,
  promoEndsAt,
  standardMonthly,
  foundingMonthly,
  signupHref,
  loginHref = "/login",
}: LandingPageProps) {
  const foundingLabel = currency(foundingMonthly);
  const standardLabel = currency(standardMonthly);
  const showCountdown = promoActive && promoEndsAt;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes mkt-fade-up {
              from { opacity: 0; transform: translateY(16px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mkt-slide-in {
              from { opacity: 0; transform: translateX(-12px); }
              to { opacity: 1; transform: translateX(0); }
            }
            @keyframes mkt-reveal {
              from { opacity: 0; transform: translateY(24px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .mkt-hero-title { animation: mkt-fade-up 0.7s ease-out both; }
            .mkt-hero-lead { animation: mkt-fade-up 0.7s ease-out 0.12s both; }
            .mkt-hero-cta { animation: mkt-slide-in 0.65s ease-out 0.24s both; }
            .mkt-step { animation: mkt-reveal 0.55s ease-out both; }
            @media (prefers-reduced-motion: reduce) {
              .mkt-hero-title, .mkt-hero-lead, .mkt-hero-cta, .mkt-step {
                animation: none;
              }
            }
          `,
        }}
      />

      <MarketingNav loginHref={loginHref} signupHref={signupHref} />

      <main>
        {/* Hero - full bleed, no cards */}
        <section className="relative overflow-hidden bg-foreground text-background">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                "repeating-linear-gradient(90deg, #B28F5D 0, #B28F5D 1px, transparent 1px, transparent 80px), repeating-linear-gradient(0deg, #B28F5D 0, #B28F5D 1px, transparent 1px, transparent 80px)",
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-0 right-0 h-px bg-gold/40"
          />

          <div className="relative mx-auto flex min-h-[calc(100svh-3.5rem)] max-w-6xl flex-col justify-center px-4 py-16 sm:min-h-[calc(100svh-4rem)] sm:px-6 sm:py-24">
            <p className="eyebrow text-stone-300/80">Procurement execution</p>
            <p className="mt-6 font-display text-5xl tracking-wide sm:text-6xl lg:text-7xl">
              BROST <span className="text-gold">CO</span>
            </p>

            <h1 className="mkt-hero-title mt-8 max-w-3xl font-display text-3xl font-semibold leading-tight sm:text-4xl lg:text-5xl">
              Government contracting, organized into work you can actually finish.
            </h1>
            <p className="mkt-hero-lead mt-4 max-w-xl text-base leading-relaxed text-stone-300 sm:text-lg">
              One Today queue, scored opportunities, subcontractor coverage, and bid
              packages that arrive ready for your review.
            </p>

            <div className="mkt-hero-cta mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link href={signupHref} className="btn-primary bg-gold text-foreground hover:bg-gold/90">
                Lock in {foundingLabel}/month
              </Link>
              <a href="#how-it-works" className="btn-ghost border-stone-600 text-background hover:bg-white/5">
                See how it works
              </a>
            </div>
          </div>
        </section>

        {/* Problem */}
        <section className="border-b border-border bg-background px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="The problem"
              title="Federal bids sprawl across inboxes, spreadsheets, and memory."
              lead="Most small contractors lose hours to SAM.gov tabs, subcontractor phone tags, and deadline surprises. Work stalls because nobody can see whose turn it is."
            />
            <ul className="mt-10 grid gap-6 sm:grid-cols-3">
              {[
                {
                  title: "Too many portals",
                  body: "Postings, emails, calls, and forms live in different places. Context disappears between steps.",
                },
                {
                  title: "Unclear priorities",
                  body: "Without scoring, every opportunity feels urgent until a deadline proves it was not worth the chase.",
                },
                {
                  title: "Sub coverage gaps",
                  body: "Pricing slips when trades are missing, follow-ups are forgotten, and quotes sit in someone's notebook.",
                },
              ].map((item) => (
                <li key={item.title} className="accent-left">
                  <h3 className="font-display text-lg font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* How it works - 7 steps */}
        <section
          id="how-it-works"
          className="scroll-mt-24 border-b border-border bg-surface px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="How it works"
              title="Seven stages from posting to submitted bid."
              lead="Most steps run on their own. You step in for judgment, calls, signatures, and submission."
            />
            <ol className="mt-12 space-y-0">
              {STEPS.map((step, i) => (
                <li
                  key={step.n}
                  className="mkt-step flex gap-5 border-b border-border py-6 last:border-b-0 sm:gap-8"
                  style={{ animationDelay: `${i * 0.06}s` }}
                >
                  <span className="num flex h-9 w-9 shrink-0 items-center justify-center border-2 border-accent text-sm font-semibold text-accent">
                    {step.n}
                  </span>
                  <div>
                    <h3 className="font-display text-xl font-semibold text-foreground">
                      {step.title}
                    </h3>
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Today / Features */}
        <section
          id="features"
          className="scroll-mt-24 border-b border-border bg-background px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Today"
              title="Open the app and know exactly what needs you."
              lead="Today is the home screen. Real tasks from live pipeline stages, ordered by urgency, not a generic dashboard."
            />

            <div className="mt-10 border border-border-strong bg-surface-raised">
              <div className="border-b border-border bg-background px-4 py-3">
                <p className="eyebrow">Today</p>
                <p className="font-display text-lg font-semibold text-foreground">
                  Tuesday, Aug 11
                </p>
              </div>

              <div className="divide-y divide-border">
                <div className="px-4 py-4">
                  <p className="eyebrow text-pursue-strong">Do this first</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    Review: HVAC maintenance, Sacramento VA Medical Center
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Score 62 · Review tier · Due in 9 days · $840K est.
                  </p>
                  <div className="mt-3 flex gap-2">
                    <span className="rounded-md border border-pursue/40 bg-pursue-soft px-2.5 py-1 text-xs font-medium text-pursue-strong">
                      Pursue
                    </span>
                    <span className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground">
                      Pass
                    </span>
                  </div>
                </div>

                <div className="px-4 py-4">
                  <p className="eyebrow">Calls to make</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    Follow up: Bay Area Mechanical on quote request
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Roofing replacement, Travis AFB · Emailed 3 days ago · No reply
                  </p>
                </div>

                <div className="px-4 py-4">
                  <p className="eyebrow">Subcontractor outreach</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    2 trades still need coverage on janitorial recompete
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    GSA Region 9 · Electrical and low-voltage · Due in 14 days
                  </p>
                </div>

                <div className="px-4 py-4">
                  <p className="eyebrow">Pricing check</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    Quote out of range: concrete sub at 34% above comps
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Parking lot repair, Presidio of Monterey · Confirm or replace sub
                  </p>
                </div>

                <div className="px-4 py-4">
                  <p className="eyebrow">Waiting on the government</p>
                  <p className="mt-1 text-sm font-medium text-foreground">
                    Submitted 18 days ago: landscape maintenance IDIQ
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    NAVFAC Southwest · No action required until decision
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Scoring */}
        <section
          id="scoring"
          className="scroll-mt-24 border-b border-border bg-surface px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Opportunity scoring"
              title="Every posting gets a number and a plain reason."
              lead="Scoring compares each record to your company profile so Pursue-tier work moves forward and distractions are cut early."
            />

            <div className="mt-10 grid gap-8 lg:grid-cols-2">
              <div>
                <p className="label mb-3">What the score reflects</p>
                <ul className="space-y-3 text-sm leading-relaxed text-muted-foreground">
                  <li className="flex gap-2">
                    <span className="text-gold">·</span>
                    NAICS and trade fit against your registered scope
                  </li>
                  <li className="flex gap-2">
                    <span className="text-gold">·</span>
                    Place of performance vs. your service areas
                  </li>
                  <li className="flex gap-2">
                    <span className="text-gold">·</span>
                    Set-aside eligibility and contract size band
                  </li>
                  <li className="flex gap-2">
                    <span className="text-gold">·</span>
                    Deadline feasibility and solicitation risk flags
                  </li>
                  <li className="flex gap-2">
                    <span className="text-gold">·</span>
                    Historical outcomes that sharpen future tiers
                  </li>
                </ul>
              </div>

              <div className="border border-border bg-background p-5">
                <p className="label">Example breakdown</p>
                <p className="mt-2 font-display text-4xl font-semibold text-accent">
                  <span className="num">78</span>
                  <span className="ml-2 text-base font-normal text-muted-foreground">
                    Pursue
                  </span>
                </p>
                <dl className="mt-4 space-y-2 text-sm">
                  {[
                    ["Trade fit", "+18"],
                    ["Geography", "+14"],
                    ["Set-aside match", "+12"],
                    ["Size band", "+10"],
                    ["Deadline buffer", "+9"],
                    ["Risk flags", "-5"],
                  ].map(([label, pts]) => (
                    <div key={label} className="flex justify-between border-b border-border py-1.5">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="num font-medium text-foreground">{pts}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          </div>
        </section>

        {/* Sourcing */}
        <section
          id="sourcing"
          className="scroll-mt-24 border-b border-border bg-background px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Subcontractor sourcing"
              title="Coverage you can see before pricing slips."
              lead="Brost Co reuses reliable subs from your roster, finds local candidates by trade, verifies contact info, and tracks every touch on the opportunity and the sub record."
            />

            <div className="mt-10 border border-border">
              <div className="grid grid-cols-4 border-b border-border bg-surface text-left">
                <span className="label px-4 py-2">Trade</span>
                <span className="label px-4 py-2">Status</span>
                <span className="label px-4 py-2">Subs paired</span>
                <span className="label px-4 py-2">Last touch</span>
              </div>
              {[
                ["HVAC", "Quote received", "3", "Bay Area Mechanical · 1d ago"],
                ["Electrical", "Awaiting reply", "4", "Follow-up sent · 2d ago"],
                ["Plumbing", "Needs call", "2", "Interested reply · today"],
                ["Controls", "Thin coverage", "1", "Flagged for you · today"],
              ].map(([trade, status, count, touch]) => (
                <div
                  key={trade}
                  className="grid grid-cols-4 border-b border-border last:border-b-0"
                >
                  <span className="px-4 py-3 text-sm font-medium text-foreground">
                    {trade}
                  </span>
                  <span className="px-4 py-3 text-sm text-muted-foreground">{status}</span>
                  <span className="num px-4 py-3 text-sm text-foreground">{count}</span>
                  <span className="px-4 py-3 text-xs text-muted-foreground">{touch}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Automation */}
        <section className="border-b border-border bg-surface px-4 py-16 sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Automation"
              title="Finish a call, and the pipeline updates itself."
              lead="When you save a call workspace, quotes, stage, subcontractor history, and Today all reflect the outcome without retyping."
            />

            <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_auto_1fr] lg:items-center">
              <div className="border border-border bg-background p-4">
                <p className="label">Call workspace saved</p>
                <p className="mt-2 text-sm font-medium text-foreground">
                  Bay Area Mechanical · Roofing, Travis AFB
                </p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Outcome</dt>
                    <dd className="text-pursue-strong">Quote provided</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Roofing quote</dt>
                    <dd className="num font-medium">$284,500</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Notes</dt>
                    <dd className="text-right text-muted-foreground">
                      60-day lead time confirmed
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="hidden text-center lg:block" aria-hidden>
                <span className="font-display text-2xl text-gold">&rarr;</span>
              </div>

              <div className="border border-border bg-background p-4">
                <p className="label">Updated automatically</p>
                <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                  <li>Opportunity stage moved to quote entry</li>
                  <li>Roofing trade marked covered on coverage strip</li>
                  <li>Sub record: call logged, reliability note appended</li>
                  <li>Today: pricing check queued if quote is out of range</li>
                  <li>Automation log: call-prep agent run recorded</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section
          id="pricing"
          className="scroll-mt-24 border-b border-border bg-background px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="Pricing"
              title="Founding members lock in a lower monthly rate."
              lead="One subscription covers monitoring, scoring, sourcing, bid assembly, and Today. No per-seat surprise fees on the base plan."
            />

            <div className="mt-10 max-w-lg border border-border-strong bg-surface p-6 sm:p-8">
              <p className="label">Monthly subscription</p>
              <p className="mt-3 text-sm text-muted-foreground">
                <span className="num line-through">{standardLabel}</span>
                <span className="ml-2">standard</span>
              </p>
              <p className="mt-1 font-display text-4xl font-semibold text-foreground">
                <span className="num">{foundingLabel}</span>
                <span className="text-lg font-normal text-muted-foreground">/mo</span>
              </p>
              <p className="mt-1 text-sm text-accent-strong">Founding rate, locked in while subscribed</p>

              {showCountdown && (
                <div className="mt-6">
                  <PromoCountdown endsAtIso={promoEndsAt} />
                </div>
              )}

              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li>· SAM.gov intake and opportunity scoring</li>
                <li>· Subcontractor sourcing and outreach</li>
                <li>· Bid package assembly and compliance checks</li>
                <li>· Today queue and full pipeline visibility</li>
              </ul>

              <Link href={signupHref} className="btn-primary mt-8 w-full">
                Lock in {foundingLabel}/month
              </Link>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          className="scroll-mt-24 border-b border-border bg-surface px-4 py-16 sm:px-6 sm:py-20"
        >
          <div className="mx-auto max-w-6xl">
            <SectionHeading
              eyebrow="FAQ"
              title="Straight answers before you sign up."
              lead="Brost Co is built for operators who need clarity, not hype."
            />

            <dl className="mt-10 divide-y divide-border border-y border-border">
              {FAQ.map((item) => (
                <div key={item.q} className="py-5">
                  <dt className="font-display text-lg font-semibold text-foreground">
                    {item.q}
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                    {item.a}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Final CTA */}
        <section className="bg-foreground px-4 py-16 text-background sm:px-6 sm:py-20">
          <div className="mx-auto max-w-6xl text-center">
            <p className="eyebrow text-stone-400">Get started</p>
            <h2 className="mt-3 font-display text-3xl font-semibold sm:text-4xl">
              Put federal contracting on a schedule you can keep.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-stone-300">
              Join founding members at {foundingLabel}/month. Setup takes an
              afternoon. Today tells you what to do every morning after that.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href={signupHref}
                className="btn-primary bg-gold text-foreground hover:bg-gold/90"
              >
                Lock in {foundingLabel}/month
              </Link>
              <Link href={loginHref} className="btn-ghost border-stone-600 text-background hover:bg-white/5">
                Login to existing account
              </Link>
            </div>
          </div>
        </section>
      </main>

      <MarketingFooter loginHref={loginHref} />
    </>
  );
}
