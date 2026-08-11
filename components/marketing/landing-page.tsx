import Link from "next/link";
import { currency } from "@/lib/format";
import { Wordmark } from "@/components/wordmark";
import { MarketingNav } from "./marketing-nav";
import { MarketingFooter } from "./marketing-footer";
import { PromoCountdown } from "./promo-countdown";
import {
  AnalysisMock,
  CoverageMock,
  OpportunityMock,
  PulseMock,
} from "./landing-mocks";

export interface LandingPageProps {
  promoActive: boolean;
  promoEndsAt: string | null;
  standardMonthly: number;
  foundingMonthly: number;
  signupHref: string;
  loginHref?: string;
}

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
    q: "Will Brost Co guarantee wins?",
    a: "No. Scoring and automation reduce wasted effort on poor fits and speed up good ones. Outcomes still depend on your pricing, past performance, and the competition.",
  },
  {
    q: "How is this different from a generic CRM?",
    a: "Brost Co is built around the federal bid lifecycle: NAICS fit, set-asides, subcontractor coverage, compliance gates, and SAM.gov intake. Stages, Today, and opportunity pages follow that journey instead of generic deal fields.",
  },
] as const;

const STAGES = [
  {
    title: "Find",
    body: "Matching SAM.gov postings land in your pipeline on a steady schedule.",
  },
  {
    title: "Triage",
    body: "Each record is scored 0-100. Strong fits move. Borderline ones wait for you.",
  },
  {
    title: "Capture",
    body: "Subs are sourced, contacted, and followed up until pricing is in hand.",
  },
  {
    title: "Bid",
    body: "Packages assemble to your margin. You review, clear human items, and submit.",
  },
] as const;

const VALUE_POINTS = [
  {
    title: "High-level visibility",
    body: "Today shows every human action across the pipeline, ordered by urgency.",
  },
  {
    title: "Capture intelligence",
    body: "Plain-English briefs and score breakdowns explain fit before you spend an hour reading.",
  },
  {
    title: "Bid or no-bid clarity",
    body: "Pursue and pass decisions happen in one place, with automation ready to continue.",
  },
] as const;

const PREP_POINTS = [
  "Monitors federal postings against your company profile",
  "Scores fit and writes a plain-English opportunity brief",
  "Sources and contacts subcontractors for required trades",
  "Tracks quotes, coverage gaps, and follow-ups automatically",
  "Assembles bid packages with compliance checks before you sign",
  "Keeps one Guide Me layer so you always know what to do next",
] as const;

const PROCESS = [
  {
    title: "The opportunity lifecycle",
    body: "From SAM.gov intake through submission and award, every stage has an owner: Brost Co, you, a sub, or the agency.",
  },
  {
    title: "The technical screening",
    body: "NAICS, geography, set-aside, size, deadline, and risk flags decide pursue, review, or ignore before you invest time.",
  },
  {
    title: "The pursuit rhythm",
    body: "Calls, quotes, and package review show up on Today when they need a person. Empty Today means automation is working.",
  },
] as const;

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
  const primaryCta = promoActive ? `Lock in ${foundingLabel}/month` : "Get started";
  const pricingFaq = promoActive
    ? `Standard pricing is ${standardLabel} per month. Founding customers who join during the launch window lock in ${foundingLabel} per month for as long as they remain subscribed.`
    : `Brost Co is ${standardLabel} per month.`;
  const faqItems = [
    ...FAQ.slice(0, 4),
    { q: "How much does Brost Co cost?", a: pricingFaq },
    ...FAQ.slice(4),
  ];

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes mkt-fade-up {
              from { opacity: 0; transform: translateY(18px); }
              to { opacity: 1; transform: translateY(0); }
            }
            @keyframes mkt-rise {
              from { opacity: 0; transform: translateY(28px) scale(0.985); }
              to { opacity: 1; transform: translateY(0) scale(1); }
            }
            @keyframes mkt-glow {
              0%, 100% { opacity: 0.35; }
              50% { opacity: 0.7; }
            }
            .mkt-hero-brand { animation: mkt-fade-up 0.65s ease-out both; }
            .mkt-hero-title { animation: mkt-fade-up 0.7s ease-out 0.08s both; }
            .mkt-hero-lead { animation: mkt-fade-up 0.7s ease-out 0.16s both; }
            .mkt-hero-cta { animation: mkt-fade-up 0.7s ease-out 0.24s both; }
            .mkt-hero-mock { animation: mkt-rise 0.9s ease-out 0.32s both; }
            .mkt-glow {
              animation: mkt-glow 6s ease-in-out infinite;
            }
            @media (prefers-reduced-motion: reduce) {
              .mkt-hero-brand, .mkt-hero-title, .mkt-hero-lead, .mkt-hero-cta, .mkt-hero-mock, .mkt-glow {
                animation: none;
              }
            }
          `,
        }}
      />

      <div className="bg-[#0a0a0a]">
        <MarketingNav
          loginHref={loginHref}
          signupHref={signupHref}
          onLanding
          variant="dark"
        />

        <main>
          {/* Hero */}
          <section className="relative overflow-hidden bg-[#0a0a0a] text-white">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.08]"
              style={{
                backgroundImage:
                  "linear-gradient(rgba(178,143,93,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(178,143,93,0.35) 1px, transparent 1px)",
                backgroundSize: "72px 72px",
              }}
            />
            <div
              aria-hidden
              className="mkt-glow pointer-events-none absolute -right-24 -top-24 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgba(178,143,93,0.28),transparent_65%)]"
            />

            <div className="relative mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20">
              <div className="mkt-hero-brand">
                <Wordmark
                  variant="light"
                  priority
                  className="h-10 sm:h-14 lg:h-16"
                />
              </div>

              <h1 className="mkt-hero-title mt-8 max-w-4xl font-display text-3xl leading-[1.12] sm:text-5xl lg:text-[3.5rem]">
                Stop chasing federal bids. Start running the{" "}
                <span className="text-gold">entire pipeline</span>.
              </h1>

              <p className="mkt-hero-lead mt-5 max-w-xl text-base leading-relaxed text-white/65 sm:text-lg">
                Brost Co is procurement execution software for federal services contractors.
                It finds, scores, sources, and prepares opportunities so you only step in for
                judgment, calls, and submission.
              </p>

              <div className="mkt-hero-cta mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href={signupHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-[#c4a06e]"
                >
                  {primaryCta}
                </Link>
                <a
                  href="#platform"
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/25 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
                >
                  See the platform
                </a>
              </div>

              <div className="mkt-hero-mock mt-14 sm:mt-16">
                <PulseMock />
              </div>
            </div>
          </section>

          {/* 01 Problem / value */}
          <section className="bg-[#F7F4EE] px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-6xl">
              <p className="font-display text-7xl leading-none text-black/[0.06] sm:text-8xl">
                01
              </p>
              <h2 className="-mt-6 max-w-3xl font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
                Good opportunities do not disappear all at once.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                They leak through missed follow-ups, thin sub coverage, unread amendments, and
                deadlines that sneak up while work sits in inboxes. Brost Co keeps the full
                pursuit visible so leakage is obvious before it costs the bid.
              </p>

              <ul className="mt-14 grid gap-8 sm:grid-cols-3">
                {VALUE_POINTS.map((item) => (
                  <li key={item.title}>
                    <div className="mb-4 h-px w-10 bg-gold" />
                    <h3 className="font-display text-xl text-foreground">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Pipeline stages */}
          <section
            id="pipeline"
            className="scroll-mt-24 bg-[#0a0a0a] px-4 py-20 text-white sm:px-6 sm:py-28"
          >
            <div className="mx-auto max-w-6xl">
              <h2 className="max-w-3xl font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                Everything between SAM.gov and submitted.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/60 sm:text-lg">
                Brost Co runs the stretch most teams cobble together from spreadsheets, shared
                inboxes, and memory.
              </p>

              <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
                {STAGES.map((stage, i) => (
                  <li
                    key={stage.title}
                    className="border-t border-white/15 pt-5"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                      0{i + 1} · {stage.title}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-white/65">{stage.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* Platform */}
          <section
            id="platform"
            className="scroll-mt-24 bg-[#F7F4EE] px-4 py-20 sm:px-6 sm:py-28"
          >
            <div className="mx-auto max-w-6xl">
              <h2 className="max-w-3xl font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
                Open the platform. Focus only on what deserves you.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Today, opportunity pages, and Guide Me share one source of truth. When something
                needs a person, it is obvious. When Brost Co is handling it, you can wait.
              </p>
              <div className="mt-12">
                <OpportunityMock />
              </div>
            </div>
          </section>

          {/* Scoring */}
          <section
            id="scoring"
            className="scroll-mt-24 bg-[#0a0a0a] px-4 py-20 text-white sm:px-6 sm:py-28"
          >
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className="font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                  Know why an opportunity is a go long before you spend an hour on it.
                </h2>
                <p className="mt-5 text-base leading-relaxed text-white/60 sm:text-lg">
                  Every posting gets a 0-100 fit score against your company profile, plus a
                  plain-English brief. Pursue-tier work moves automatically. Review-tier work
                  waits for your call.
                </p>
              </div>
              <AnalysisMock />
            </div>
          </section>

          {/* Coverage */}
          <section className="bg-[#F7F4EE] px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-6xl">
              <h2 className="max-w-3xl font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
                Trust your coverage. Nothing falls out of the pursuit.
              </h2>
              <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                Per-trade visibility shows who was found, contacted, quoted, and which scopes
                still block the bid. Follow-ups and call cards appear on Today before the
                deadline owns the day.
              </p>
              <div className="mt-12">
                <CoverageMock />
              </div>
            </div>
          </section>

          {/* Prep list */}
          <section className="bg-[#0a0a0a] px-4 py-20 text-white sm:px-6 sm:py-28">
            <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
              <h2 className="font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                Brost Co does the preparation. You keep the outcome.
              </h2>
              <ul className="space-y-0">
                {PREP_POINTS.map((point) => (
                  <li
                    key={point}
                    className="border-t border-white/12 py-4 text-base text-white/70 first:border-t-0"
                  >
                    <span className="mr-3 text-gold">+</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Process grid */}
          <section className="bg-[#F7F4EE] px-4 py-20 sm:px-6 sm:py-28">
            <div className="mx-auto max-w-6xl">
              <h2 className="max-w-3xl font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
                A disciplined process without building a larger capture team.
              </h2>
              <ul className="mt-14 grid gap-10 sm:grid-cols-3">
                {PROCESS.map((item) => (
                  <li key={item.title}>
                    <div className="mb-4 h-px w-10 bg-gold" />
                    <h3 className="font-display text-xl text-foreground">{item.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                      {item.body}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Pricing */}
          <section
            id="pricing"
            className="scroll-mt-24 bg-[#0a0a0a] px-4 py-20 text-white sm:px-6 sm:py-28"
          >
            <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 lg:gap-16">
              <div>
                <h2 className="font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                  Run a stronger federal pipeline for a fraction of the usual cost.
                </h2>
                <p className="mt-5 text-base leading-relaxed text-white/60 sm:text-lg">
                  One subscription covers monitoring, scoring, sourcing, bid assembly, Today,
                  and Guide Me. No per-seat surprise fees on the base plan.
                </p>
              </div>

              <div className="rounded-lg border border-white/12 bg-[#141414] p-6 sm:p-8">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">
                  Monthly subscription
                </p>
                {promoActive ? (
                  <>
                    <p className="mt-4 text-sm text-white/45">
                      <span className="num line-through">{standardLabel}</span>
                      <span className="ml-2">standard</span>
                    </p>
                    <p className="mt-1 font-display text-5xl text-white">
                      <span className="num text-gold">{foundingLabel}</span>
                      <span className="text-lg text-white/45">/mo</span>
                    </p>
                    <p className="mt-2 text-sm text-gold/90">
                      Founding rate, locked in while subscribed
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-4 font-display text-5xl text-white">
                      <span className="num text-gold">{standardLabel}</span>
                      <span className="text-lg text-white/45">/mo</span>
                    </p>
                    <p className="mt-2 text-sm text-white/45">Standard rate, billed monthly</p>
                  </>
                )}

                {showCountdown && (
                  <div className="mt-6 rounded-md border border-white/10 bg-black/30 p-3">
                    <PromoCountdown endsAtIso={promoEndsAt} variant="dark" />
                  </div>
                )}

                <ul className="mt-6 space-y-2 text-sm text-white/60">
                  <li>SAM.gov intake and opportunity scoring</li>
                  <li>Subcontractor sourcing and outreach</li>
                  <li>Bid package assembly and compliance checks</li>
                  <li>Today queue plus Guide Me on every page</li>
                </ul>

                <Link
                  href={signupHref}
                  className="mt-8 inline-flex min-h-11 w-full items-center justify-center rounded-md bg-gold px-5 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-[#c4a06e]"
                >
                  {promoActive
                    ? `Lock in ${foundingLabel}/month`
                    : `Subscribe at ${standardLabel}/month`}
                </Link>
              </div>
            </div>
          </section>

          {/* FAQ */}
          <section
            id="faq"
            className="scroll-mt-24 bg-[#F7F4EE] px-4 py-20 sm:px-6 sm:py-28"
          >
            <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
              <div>
                <h2 className="font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-5xl">
                  Understand the system before you trust it with your pipeline.
                </h2>
                <p className="mt-5 text-base leading-relaxed text-muted-foreground">
                  Straight answers. No hype about automatic wins or replacing your judgment.
                </p>
              </div>

              <div className="divide-y divide-border border-y border-border">
                {faqItems.map((item) => (
                  <details key={item.q} className="group py-5">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-display text-lg text-foreground [&::-webkit-details-marker]:hidden">
                      <span>{item.q}</span>
                      <span
                        aria-hidden
                        className="mt-1 shrink-0 text-gold transition-transform group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-3 pr-8 text-sm leading-relaxed text-muted-foreground sm:text-base">
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </section>

          {/* Final CTA */}
          <section className="bg-[#0a0a0a] px-4 py-20 text-center text-white sm:px-6 sm:py-28">
            <div className="mx-auto max-w-3xl">
              <h2 className="font-display text-3xl leading-tight sm:text-4xl lg:text-5xl">
                Stop managing the process. Start running the pipeline.
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-white/60">
                {promoActive ? (
                  <>
                    Join founding members at {foundingLabel}/month. Setup takes an afternoon.
                    Today tells you what to do every morning after that.
                  </>
                ) : (
                  <>
                    Subscribe at {standardLabel}/month. Setup takes an afternoon. Today tells
                    you what to do every morning after that.
                  </>
                )}
              </p>
              <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Link
                  href={signupHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-md bg-gold px-6 py-2.5 text-sm font-semibold text-[#0a0a0a] transition-colors hover:bg-[#c4a06e]"
                >
                  {primaryCta}
                </Link>
                <Link
                  href={loginHref}
                  className="inline-flex min-h-11 items-center justify-center rounded-md border border-white/25 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
                >
                  Login to existing account
                </Link>
              </div>
            </div>
          </section>
        </main>

        <MarketingFooter loginHref={loginHref} variant="dark" />
      </div>
    </>
  );
}
