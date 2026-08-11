import Link from "next/link";
import { currency } from "@/lib/format";
import { Wordmark } from "@/components/wordmark";
import { BrandMark } from "@/components/brand-mark";
import { PromoCountdown } from "./promo-countdown";
import { LandingFaq } from "./landing-faq";
import "./landing.css";

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
    a: "Brost Co is procurement execution software for federal services contractors. It monitors SAM.gov, evaluates opportunities against your business, helps source subcontractors, prepares bid packages, and gives your team one prioritized list of work that needs attention.",
  },
  {
    q: "Does Brost Co replace SAM.gov?",
    a: "No. SAM.gov remains the official source for federal opportunities and entity registration. Brost Co organizes and advances the work after opportunities are published.",
  },
  {
    q: "Does Brost Co submit bids automatically?",
    a: "No. Brost Co prepares and validates the bid package, but you retain final control. Signatures, attestations, and submission stay with your team.",
  },
  {
    q: "Who is Brost Co built for?",
    a: "Brost Co is designed for small and mid-size federal services contractors pursuing construction, facilities, and professional services work without a large in-house capture team.",
  },
  {
    q: "How is this different from a CRM?",
    a: "A general CRM tracks deals. Brost Co runs the federal bid lifecycle, including NAICS fit, set-asides, solicitation deadlines, subcontractor coverage, pricing, compliance gates, and submission readiness.",
  },
] as const;

const WORKFLOW = [
  {
    n: "01",
    title: "Tell Brost Co what fits",
    body: "Set your NAICS codes, services, set-asides, contract size, and service area once.",
  },
  {
    n: "02",
    title: "Let the right work surface",
    body: "Matching SAM.gov opportunities enter your pipeline with deadlines and documents attached.",
  },
  {
    n: "03",
    title: "See the fit before you chase it",
    body: "Every opportunity receives a score, risk flags, and a plain-English recommendation.",
  },
  {
    n: "04",
    title: "Build coverage and pricing",
    body: "Source subcontractors, manage outreach, collect quotes, and spot missing trades early.",
  },
  {
    n: "05",
    title: "Review a complete bid package",
    body: "Pricing, compliance checks, certifications, and final documents arrive ready for review.",
  },
  {
    n: "06",
    title: "Submit with control",
    body: "You approve the final package and submit through the required agency channel.",
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
  const monthlySavings = currency(standardMonthly - foundingMonthly);
  const showCountdown = promoActive && promoEndsAt;
  const primaryCta = promoActive
    ? "Start with founding access"
    : "Get started";
  const priceCta = promoActive
    ? `Lock in ${foundingLabel} per month`
    : `Subscribe at ${standardLabel} per month`;
  const pricingFaq = promoActive
    ? `Standard pricing is ${standardLabel} per month. Founding customers who join during the launch window lock in ${foundingLabel} per month for as long as they remain subscribed.`
    : `Brost Co is ${standardLabel} per month.`;
  const faqItems = [
    ...FAQ_BASE.slice(0, 3),
    { q: "How much does Brost Co cost?", a: pricingFaq },
    ...FAQ_BASE.slice(3),
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
              Get started <span aria-hidden="true">↗</span>
            </Link>
          </div>
          <details className="mobile-nav">
            <summary aria-label="Open navigation">
              <i />
              <i />
            </summary>
            <nav aria-label="Mobile navigation">
              <a href="#platform">Platform</a>
              <a href="#workflow">How it works</a>
              <a href="#pricing">Pricing</a>
              <a href="#faq">FAQ</a>
              <Link href={loginHref}>Log in</Link>
              <Link href={signupHref}>Get started</Link>
            </nav>
          </details>
        </header>

        <section className="hero" id="top">
          <div className="grid-bg" aria-hidden />
          <div className="gold-glow" aria-hidden />
          <div className="hero-inner">
            <div className="hero-copy">
              <div className="hero-wordmark">
                <Wordmark variant="light" priority className="h-12 sm:h-14" />
              </div>
              <p className="eyebrow light">
                <i />
                Procurement execution
              </p>
              <h1>Win the right government contracts. Stop managing the process by hand.</h1>
              <p className="lead">
                Brost Co finds the right opportunities, scores the fit, builds subcontractor
                coverage, and prepares your bids. You stay focused on the decisions only you can
                make.
              </p>
              <div className="hero-actions">
                <Link className="btn" href={signupHref}>
                  {primaryCta} <span aria-hidden="true">↗</span>
                </Link>
                <a className="under-link" href="#platform">
                  Explore the platform <span aria-hidden="true">↓</span>
                </a>
              </div>
              <div className="proof">
                <div>
                  <b>One</b>
                  <span>daily priority queue</span>
                </div>
                <div>
                  <b>0 to 100</b>
                  <span>opportunity fit scoring</span>
                </div>
                <div>
                  <b>Human</b>
                  <span>approval stays required</span>
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
              <h2>Your pipeline is not short on opportunities. It is short on clarity.</h2>
            </div>
            <div>
              <p className="editorial">
                Federal contracting creates work at every turn. When research, outreach, pricing,
                and review live across portals, inboxes, spreadsheets, and memory, good
                opportunities quietly lose momentum.
              </p>
              <div className="problem-grid">
                <article>
                  <small>01</small>
                  <h3>Too much noise</h3>
                  <p>
                    Every posting looks urgent when there is no consistent way to compare fit,
                    risk, and timing.
                  </p>
                </article>
                <article>
                  <small>02</small>
                  <h3>Too many handoffs</h3>
                  <p>
                    Details disappear between opportunity research, subcontractor outreach,
                    pricing, and final review.
                  </p>
                </article>
                <article>
                  <small>03</small>
                  <h3>Too little visibility</h3>
                  <p>
                    Your team cannot act quickly when nobody can see the next decision, missing
                    quote, or deadline.
                  </p>
                </article>
                <article className="answer">
                  <small>THE SHIFT</small>
                  <h3>One system that moves the work forward.</h3>
                  <p>Brost Co brings people in at the exact moment judgment is required.</p>
                </article>
              </div>
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
              <h2>One operating system for the work between opportunity and submission.</h2>
              <p>Every screen answers one question: what should happen now?</p>
            </header>
            <div className="bento">
              <article className="panel dark today-panel">
                <header>
                  <div>
                    <small>01</small>
                    <h3>Today</h3>
                  </div>
                  <p>Work ordered by consequence, not by the time it entered the system.</p>
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
                  <p>See the number. Understand the reason.</p>
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
                  <p>Know which trades are covered before pricing slips.</p>
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
                  <p>A complete review surface before anything leaves your hands.</p>
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
              <h2>From federal posting to submission, without losing the thread.</h2>
              <p>
                Automation handles repeatable work. Your team handles judgment, relationships,
                approval, and submission.
              </p>
              <Link className="under-link" href={signupHref}>
                Set up your company profile <span aria-hidden="true">↗</span>
              </Link>
            </div>
            <ol>
              {WORKFLOW.map((step) => (
                <li key={step.n}>
                  <span>{step.n}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
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
                  Built for judgment
                </p>
                <h2>Automated where it should be. Human where it matters.</h2>
              </div>
              <p>
                Brost Co prepares the context, recommends the next move, and keeps approval in
                your hands.
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
          <h2>Stop asking your team where the bid stands. Open Brost Co and know.</h2>
          <p>THE OPERATING PRINCIPLE</p>
        </section>

        <section className="pricing section" id="pricing">
          <div className="shell pricing-layout">
            <div className="sticky">
              <p className="eyebrow light">
                <i />
                {promoActive ? "Founding access" : "Pricing"}
              </p>
              <h2>Build a disciplined federal pipeline before you build a larger team.</h2>
              <p>
                One subscription includes opportunity monitoring, scoring, subcontractor
                sourcing, bid preparation, and your daily priority queue.
              </p>
              {promoActive && (
                <aside>
                  <b>FOUNDING RATE</b>
                  <span>Locked for the life of your active subscription.</span>
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
                  </p>
                </>
              ) : (
                <>
                  <div className="price" style={{ marginTop: 28 }}>
                    <strong>{standardLabel}</strong>
                    <span>/month</span>
                  </div>
                  <p>Standard rate, billed monthly.</p>
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
                {priceCta} <span aria-hidden="true">↗</span>
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
            <h2>Put your federal pipeline on a schedule you can keep.</h2>
            <p>
              Set up your profile once. Open Today every morning. Give the right opportunities
              the attention they deserve.
            </p>
            <Link className="btn" href={signupHref}>
              {primaryCta} <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </section>

        <footer>
          <div className="footer-top">
            <div>
              <Link className="type-logo footer-logo" href="#top" aria-label="Brost Co home">
                <Wordmark variant="dark" className="h-7" />
              </Link>
              <p>Procurement execution for federal services contractors.</p>
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
