import Link from "next/link";
import { currency } from "@/lib/format";
import { Wordmark } from "@/components/wordmark";
import { BrandMark } from "@/components/brand-mark";
import { PromoCountdown } from "./promo-countdown";
import { LandingFaq } from "./landing-faq";
import { LandingMobileNav } from "./landing-mobile-nav";
import "./landing.css";

/** Thin horizontal arrow for primary CTAs (replaces diagonal ↗). */
function CtaArrow() {
  return (
    <span className="btn-arrow" aria-hidden="true">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M2.5 8h11M9.5 4.5 13 8l-3.5 3.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export interface LandingPageProps {
  promoActive: boolean;
  promoEndsAt: string | null;
  standardMonthly: number;
  foundingMonthly: number;
  signupHref: string;
  loginHref?: string;
}

const FAQ_BASE = [
  {
    q: "What is Brost Co?",
    a: "Brost Co is government contracting software for federal services contractors. It watches SAM.gov for matching work, scores each opportunity against your company, finds subcontractors, tracks quotes, builds the bid package, and shows you one daily list of decisions that need a person.",
  },
  {
    q: "What work does Brost Co take off my plate?",
    a: "Brost Co handles SAM.gov intake, fit scoring, reading the solicitation, finding and emailing subcontractors, quote tracking, package assembly, and compliance checks. You keep pursue-or-pass decisions, calls when a person is needed, quote entry, and final submission.",
  },
  {
    q: "Does Brost Co replace SAM.gov?",
    a: "No. SAM.gov remains the official source for federal opportunities and entity registration. Brost Co organizes and advances the work after opportunities are published.",
  },
  {
    q: "Does Brost Co submit bids automatically?",
    a: "No. Brost Co prepares and validates the bid package, but you keep final control. Signatures, attestations, and submission stay with your team.",
  },
  {
    q: "Who is Brost Co built for?",
    a: "Brost Co is built for small and mid-size federal services contractors in construction, facilities, and professional services that do not have a large capture team.",
  },
  {
    q: "How is this different from a CRM?",
    a: "A general CRM tracks deals. Brost Co runs the federal bid lifecycle: NAICS fit, set-asides, deadlines, subcontractor coverage, pricing, compliance checks, and submission readiness.",
  },
] as const;

const WORKFLOW = [
  {
    n: "01",
    title: "Find the right work",
    automatic:
      "Brost Co watches SAM.gov, pulls matching postings, and scores each one against your company.",
    you: "You only decide borderline fits. Strong matches move forward on their own.",
  },
  {
    n: "02",
    title: "Get pricing",
    automatic:
      "Brost Co reads the solicitation, finds local subcontractors, emails them, and follows up.",
    you: "You call when email is not enough, then enter the quote in one place.",
  },
  {
    n: "03",
    title: "Build the package",
    automatic:
      "Brost Co rolls up pricing, assembles the bid package, and runs compliance checks.",
    you: "You review the package and clear anything only a person can sign or attest.",
  },
  {
    n: "04",
    title: "Submit",
    automatic: "Brost Co keeps the deadline visible and waits with you for the agency decision.",
    you: "You submit through the required agency channel. Nothing leaves without your approval.",
  },
] as const;

const BROST_HANDLES = [
  "SAM.gov intake and document gathering",
  "Fit scoring and pursue recommendations",
  "Plain-English solicitation brief",
  "Finding and emailing subcontractors",
  "Quote tracking and missing-trade alerts",
  "Bid package assembly and compliance checks",
] as const;

const YOU_HANDLE = [
  "Pursue or pass on borderline opportunities",
  "Calls when a person is needed",
  "Entering subcontractor quotes",
  "Final review and submission",
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
  const monthlySavings = currency(standardMonthly - foundingMonthly);
  const showCountdown = promoActive && promoEndsAt;
  const primaryCta = promoActive
    ? "Start founding free trial"
    : "Start free trial";
  const priceCta = "Start 7-day free trial";
  const pricingFaq = promoActive
    ? `Standard pricing is ${standardLabel} per month. Founding customers who join during the launch window lock in ${foundingLabel} per month for as long as they remain subscribed. Every plan starts with a free 7-day trial. After the trial, your card is charged automatically unless you cancel.`
    : `Brost Co is ${standardLabel} per month. Every plan starts with a free 7-day trial. After the trial, your card is charged automatically unless you cancel.`;
  const faqItems = [
    ...FAQ_BASE.slice(0, 4),
    { q: "How much does Brost Co cost?", a: pricingFaq },
    ...FAQ_BASE.slice(4),
  ];
  const year = new Date().getFullYear();

  return (
    <div className="mkt-lp">
      <main>
        <header className="nav-shell">
          <Link className="type-logo" href="#top" aria-label="Brost Co home">
            <Wordmark variant="light" priority className="h-7" />
          </Link>
          <nav className="desktop-nav" aria-label="Primary navigation">
            <a href="#platform">Platform</a>
            <a href="#workflow">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className="nav-actions">
            <Link href={loginHref}>Log in</Link>
            <Link className="btn btn-small" href={signupHref}>
              Get started <CtaArrow />
            </Link>
          </div>
          <LandingMobileNav signupHref={signupHref} loginHref={loginHref} />
        </header>

        <section className="hero" id="top">
          <div className="grid-bg" aria-hidden />
          <div className="gold-glow" aria-hidden />
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow light">
                <i />
                Government contracting software
              </p>
              <h1>Brost Co does the hard, slow parts of government contracting</h1>
              <p className="lead">
                Brost Co watches SAM.gov, scores each opportunity against your company, finds and
                emails subcontractors, and builds the bid package. You open one daily list for
                pursue-or-pass, a few calls, and final approval. Nothing goes to the agency until
                you say so.
              </p>
              <div className="hero-actions">
                <Link className="btn" href={signupHref}>
                  {primaryCta} <CtaArrow />
                </Link>
                <a className="under-link" href="#split">
                  See who does the work <span aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="proof">
                <div>
                  <b>Hours of SAM scanning</b>
                  <span>off your plate</span>
                </div>
                <div>
                  <b>Sub outreach and follow-up</b>
                  <span>automatic</span>
                </div>
                <div>
                  <b>You approve</b>
                  <span>every bid before it goes out</span>
                </div>
              </div>
            </div>

            <div className="hero-product" aria-hidden>
              <aside className="orbit top">
                SAM.GOV INTAKE <b>Complete</b>
              </aside>
              <div className="app-window">
                <div className="app-bar">
                  <span className="app-brand">
                    <BrandMark size="sm" />
                  </span>
                  <b>Today</b>
                  <em>AUG 11</em>
                </div>
                <div className="app-body">
                  <div className="queue-title">
                    <div>
                      <label>Needs your attention</label>
                      <h3>3 decisions. 18 minutes.</h3>
                    </div>
                    <span>LIVE</span>
                  </div>
                  <div className="task priority">
                    <i>01</i>
                    <div>
                      <label>Decision needed</label>
                      <b>HVAC maintenance, Boise VA</b>
                      <span>Score 84 · Due in 12 days · $1.2M estimate</span>
                    </div>
                    <button type="button">Review</button>
                  </div>
                  <div className="task">
                    <i>02</i>
                    <div>
                      <label>Subcontractor follow-up</label>
                      <b>Electrical quote still outstanding</b>
                      <span>Last contact 3 days ago · Follow-up ready</span>
                    </div>
                    <button type="button">Open</button>
                  </div>
                  <div className="task">
                    <i>03</i>
                    <div>
                      <label>Final review</label>
                      <b>Grounds maintenance IDIQ</b>
                      <span>Package complete · Submission due tomorrow</span>
                    </div>
                    <button type="button">Review</button>
                  </div>
                  <div className="app-summary">
                    <span>12 tasks handled automatically today</span>
                    <b>View activity ↗</b>
                  </div>
                </div>
              </div>
              <aside className="orbit bottom">
                AUTOMATION ACTIVITY <b>12 actions today</b>
              </aside>
            </div>
          </div>
          <div className="hero-strip">
            <strong>BUILT FOR FEDERAL SERVICES CONTRACTORS</strong>
            <span>CONSTRUCTION</span>
            <span>FACILITIES</span>
            <span>PROFESSIONAL SERVICES</span>
          </div>
        </section>

        <section className="problem section">
          <div className="shell problem-layout">
            <div className="sticky">
              <p className="eyebrow">
                <i />
                The real problem
              </p>
              <h2>
                Federal bids fail in the gaps between SAM.gov, email, spreadsheets, and memory
              </h2>
            </div>
            <div>
              <p className="editorial">
                Finding work is only the start. Qualifying the fit, chasing subcontractors,
                collecting prices, and assembling a compliant package usually live in different
                tools. Brost Co puts that whole path in one place so good opportunities do not
                stall.
              </p>
              <div className="problem-grid">
                <article>
                  <small>01</small>
                  <h3>Too much noise</h3>
                  <p>
                    Without a clear fit score, every SAM.gov posting feels urgent and your team
                    chases the wrong work.
                  </p>
                </article>
                <article>
                  <small>02</small>
                  <h3>Too many handoffs</h3>
                  <p>
                    Opportunity notes, subcontractor emails, and pricing details get lost between
                    people and tools before the bid is ready.
                  </p>
                </article>
                <article>
                  <small>03</small>
                  <h3>Too little visibility</h3>
                  <p>
                    Nobody sees the next decision, the missing quote, or the deadline until it is
                    almost too late.
                  </p>
                </article>
                <article className="answer">
                  <small>THE SHIFT</small>
                  <h3>Brost Co takes the hours. You keep the judgment.</h3>
                  <p>
                    Brost Co runs the repeatable work and brings you in only when judgment,
                    a call, or approval is required.
                  </p>
                </article>
              </div>
            </div>
          </div>
        </section>

        <section className="split section" id="split">
          <div className="shell">
            <header className="center-head">
              <p className="eyebrow">
                <i />
                Who does the work
              </p>
              <h2>Brost Co takes the hours. You keep the judgment.</h2>
              <p>
                Federal contracting gets hard when every bid means scanning notices, chasing
                subcontractors, and rebuilding a package from scratch. Brost Co does that work.
                You decide, call when needed, and submit.
              </p>
            </header>
            <div className="split-grid">
              <article>
                <small>BROST CO HANDLES</small>
                <h3>The slow, repeatable work</h3>
                <ul>
                  {BROST_HANDLES.map((item, i) => (
                    <li key={item}>
                      <span>{String(i + 1).padStart(2, "0")}</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
              <article className="dark">
                <small>YOU HANDLE</small>
                <h3>Judgment, relationships, and the final send</h3>
                <ul>
                  {YOU_HANDLE.map((item) => (
                    <li key={item}>
                      <span>✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="platform section" id="platform">
          <div className="shell">
            <header className="center-head">
              <p className="eyebrow">
                <i />
                The platform
              </p>
              <h2>
                Everything from opportunity intake to a review-ready bid package
              </h2>
              <p>
                Each screen answers one question: what needs you now, and what is Brost Co
                already handling?
              </p>
            </header>
            <div className="bento">
              <article className="panel dark today-panel">
                <header>
                  <div>
                    <small>01</small>
                    <h3>Today</h3>
                  </div>
                  <p>Your daily list of pursue or pass decisions, calls, and approvals.</p>
                </header>
                <div className="today-mini" aria-hidden>
                  <div className="mini-head">
                    <span>NEEDS YOUR ATTENTION</span>
                    <b>Tuesday · Aug 11</b>
                  </div>
                  <div className="mini-row selected">
                    <i>01</i>
                    <div>
                      <b>Review opportunity recommendation</b>
                      <span>HVAC maintenance · Score 84</span>
                    </div>
                    <em>9 min</em>
                  </div>
                  <div className="mini-row">
                    <i>02</i>
                    <div>
                      <b>Call subcontractor</b>
                      <span>Electrical pricing · Due today</span>
                    </div>
                    <em>6 min</em>
                  </div>
                  <div className="mini-row">
                    <i>03</i>
                    <div>
                      <b>Approve bid package</b>
                      <span>All compliance checks passed</span>
                    </div>
                    <em>3 min</em>
                  </div>
                </div>
              </article>
              <article className="panel score-panel">
                <header>
                  <div>
                    <small>02</small>
                    <h3>Opportunity scoring</h3>
                  </div>
                  <p>A 0 to 100 fit score with clear reasons to pursue or pass.</p>
                </header>
                <div className="score-ui" aria-hidden>
                  <div className="score-ring">
                    <b>84</b>
                    <span>PURSUE</span>
                  </div>
                  <div className="score-lines">
                    <p>
                      <span>Trade fit</span>
                      <b>+24</b>
                    </p>
                    <p>
                      <span>Set-aside match</span>
                      <b>+18</b>
                    </p>
                    <p>
                      <span>Service area</span>
                      <b>+16</b>
                    </p>
                    <p>
                      <span>Risk flags</span>
                      <b>-4</b>
                    </p>
                  </div>
                </div>
              </article>
              <article className="panel">
                <header>
                  <div>
                    <small>03</small>
                    <h3>Subcontractor coverage</h3>
                  </div>
                  <p>See which trades have quotes and which still need outreach.</p>
                </header>
                <div className="coverage" aria-hidden>
                  <p>
                    <span>HVAC</span>
                    <b className="green">Quote received</b>
                    <i>3 subs</i>
                  </p>
                  <p>
                    <span>Electrical</span>
                    <b className="gold">Awaiting reply</b>
                    <i>4 subs</i>
                  </p>
                  <p>
                    <span>Plumbing</span>
                    <b className="green">Covered</b>
                    <i>2 subs</i>
                  </p>
                  <p>
                    <span>Controls</span>
                    <b className="red">Needs attention</b>
                    <i>1 sub</i>
                  </p>
                </div>
              </article>
              <article className="panel dark package">
                <header>
                  <div>
                    <small>04</small>
                    <h3>Bid package</h3>
                  </div>
                  <p>Pricing, certifications, and compliance checks in one place to review.</p>
                </header>
                <div className="package-ui" aria-hidden>
                  <div className="papers">
                    <i />
                    <i />
                    <i />
                    <b>IFB 36C</b>
                  </div>
                  <ul>
                    <li>✓ Pricing rollup complete</li>
                    <li>✓ Certifications attached</li>
                    <li>✓ Compliance review passed</li>
                    <li>✓ Ready for final approval</li>
                  </ul>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section className="workflow section" id="workflow">
          <div className="lines" aria-hidden />
          <div className="shell workflow-layout">
            <div className="workflow-copy sticky">
              <p className="eyebrow light">
                <i />
                How it works
              </p>
              <h2>Four phases from SAM.gov posting to agency submission</h2>
              <p>
                Each phase has an automatic lane and a human lane. Brost Co moves the bid
                forward. You step in for judgment, calls, and the final send.
              </p>
              <Link className="under-link" href={signupHref}>
                Set up your company profile <CtaArrow />
              </Link>
            </div>
            <ol>
              {WORKFLOW.map((step) => (
                <li key={step.n}>
                  <span>{step.n}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>
                      <b>Automatic:</b> {step.automatic}
                    </p>
                    <p>
                      <b>You:</b> {step.you}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="comparison section">
          <div className="shell">
            <header className="split-head">
              <div>
                <p className="eyebrow">
                  <i />
                  What you stop doing
                </p>
                <h2>Automated where it should be. Human where it matters.</h2>
              </div>
              <p>
                Brost Co gathers the facts, recommends the next move, and keeps every approval
                in your hands. Nothing is submitted without you.
              </p>
            </header>
            <div className="compare-grid">
              <article>
                <small>WITHOUT BROST CO</small>
                <h3>Your team reconstructs the process every time.</h3>
                <ul>
                  <li>
                    <span>01</span>Refresh SAM.gov and manually qualify postings
                  </li>
                  <li>
                    <span>02</span>Copy deadlines and details into spreadsheets
                  </li>
                  <li>
                    <span>03</span>Search inboxes for subcontractor responses
                  </li>
                  <li>
                    <span>04</span>Assemble bid documents from scattered files
                  </li>
                </ul>
              </article>
              <article className="dark">
                <small>WITH BROST CO</small>
                <h3>Your team opens one queue and moves the work forward.</h3>
                <ul>
                  <li>
                    <span>✓</span>Qualified opportunities appear with clear reasoning
                  </li>
                  <li>
                    <span>✓</span>Deadlines and next actions stay attached
                  </li>
                  <li>
                    <span>✓</span>Coverage and quote status stay visible
                  </li>
                  <li>
                    <span>✓</span>Complete packages arrive ready for review
                  </li>
                </ul>
              </article>
            </div>
          </div>
        </section>

        <section className="statement">
          <span aria-hidden>“</span>
          <h2>Stop asking where the bid stands. Open Brost Co and see the next step.</h2>
          <p>THE OPERATING PRINCIPLE</p>
        </section>

        <section className="pricing section" id="pricing">
          <div className="shell pricing-layout">
            <div className="sticky">
              <p className="eyebrow light">
                <i />
                {promoActive ? "Founding access" : "Pricing"}
              </p>
              <h2>Run a federal bid pipeline without hiring a capture team first</h2>
              <p>
                One subscription includes SAM.gov monitoring, fit scoring, subcontractor
                sourcing, quote tracking, bid package prep, and your daily Today queue.
              </p>
              {promoActive && (
                <aside>
                  <b>FOUNDING RATE</b>
                  <span>
                    Locked for the life of your active subscription. Includes a free 7-day
                    trial.
                  </span>
                </aside>
              )}
            </div>
            <div className="price-card">
              <header>
                <span>MONTHLY SUBSCRIPTION</span>
                <b>{promoActive ? "FOUNDING MEMBER" : "STANDARD"}</b>
              </header>
              {promoActive ? (
                <>
                  <del>{standardLabel} standard</del>
                  <div className="price">
                    <strong>{foundingLabel}</strong>
                    <span>/month</span>
                  </div>
                  <p>
                    Save {monthlySavings} each month while founding enrollment remains open.
                    Start with a free 7-day trial. After that, you are billed {foundingLabel}
                    per month unless you cancel.
                  </p>
                </>
              ) : (
                <>
                  <div className="price" style={{ marginTop: 28 }}>
                    <strong>{standardLabel}</strong>
                    <span>/month</span>
                  </div>
                  <p>
                    Start with a free 7-day trial. After that, you are billed {standardLabel} per
                    month unless you cancel.
                  </p>
                </>
              )}
              {showCountdown && (
                <div style={{ marginBottom: 20 }}>
                  <PromoCountdown endsAtIso={promoEndsAt} variant="dark" />
                </div>
              )}
              <ul>
                <li>✓ SAM.gov opportunity intake</li>
                <li>✓ Fit scoring and pursuit recommendations</li>
                <li>✓ Subcontractor sourcing and quote tracking</li>
                <li>✓ Bid package assembly and compliance checks</li>
                <li>✓ Today queue and complete pipeline visibility</li>
              </ul>
              <Link className="btn" href={signupHref}>
                {priceCta} <CtaArrow />
              </Link>
              <small>Final submission always requires your review and action.</small>
            </div>
          </div>
        </section>

        <section className="faq section" id="faq">
          <div className="shell faq-layout">
            <div className="sticky">
              <p className="eyebrow">
                <i />
                Clear answers
              </p>
              <h2>Know exactly what Brost Co does before you start.</h2>
              <p>Still have a question?</p>
              <a href="mailto:hello@brostco.com">
                hello@brostco.com <span aria-hidden="true">↗</span>
              </a>
            </div>
            <LandingFaq items={faqItems} />
          </div>
        </section>

        <section className="final-cta">
          <div className="grid-bg" aria-hidden />
          <div className="final-inner">
            <div className="final-wordmark">
              <Wordmark variant="light" className="h-14 sm:h-16" />
            </div>
            <p className="eyebrow light">
              <i />
              Start now
            </p>
            <h2>Start with the federal work that actually fits your company</h2>
            <p>
              Set your company profile once. Brost Co takes the hard, slow parts of each bid.
              You open Today each morning and act on the decisions that need you.
            </p>
            <Link className="btn" href={signupHref}>
              {primaryCta} <CtaArrow />
            </Link>
          </div>
        </section>

        <footer>
          <div className="footer-top">
            <div>
              <Link className="type-logo footer-logo" href="#top" aria-label="Brost Co home">
                <Wordmark variant="dark" className="h-7" />
              </Link>
              <p>Government contracting software for federal services contractors.</p>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#platform">Platform</a>
              <a href="#workflow">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
            </nav>
            <nav aria-label="Legal navigation">
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href={loginHref}>Log in</Link>
              <a href="mailto:hello@brostco.com">Contact</a>
            </nav>
          </div>
          <div className="footer-bottom">
            <span>© {year} Brost Co.</span>
            <span>Brost Co does not replace SAM.gov or submit bids without your review.</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
