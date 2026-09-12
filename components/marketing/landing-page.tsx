import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { MarketingMobileMenu } from "./mobile-menu";
import { MarketingFooter } from "./marketing-footer";
import { WorkflowGallery } from "./workflow-gallery";
import { ProductVideo } from "./product-video";
import { HeroBackgroundVideo } from "./hero-background-video";
import { TRIAL_DAYS } from "@/lib/billing/catalog";
import "./redesign.css";

export interface LandingPageProps {
  promoActive: boolean;
  promoEndsAt: string | null;
  standardMonthly: number;
  foundingMonthly: number;
  signupHref: string;
  loginHref?: string;
}

const capabilities = [
  ["Find the right work", "AI gathers and scores federal opportunities against your company profile and rules."],
  ["Know what needs you", "Today surfaces replies, calls, decisions, blockers, deadlines, and bid reviews in one queue."],
  ["Coordinate subcontractors", "Keep outreach, follow-ups, calls, replies, compliance, and quotes tied to the pursuit."],
  ["Build the bid", "Bring requirements, pricing, scope, documents, and missing information together before review."],
  ["Understand the why", "Open the source, see what the system found, and review the facts behind recommendations."],
  ["Track every action", "Use the activity ledger to see what was drafted, sent, received, completed, blocked, or still waiting."],
];

const steps = [
  ["1", "Tell BrostCo what fits", "Add your company profile, rules, target work, and supported connections."],
  ["2", "AI moves the pursuit forward", "BrostCo discovers, analyzes, organizes, follows up, and prepares work in the background."],
  ["3", "You handle the decisions", "The dashboard brings you the calls, approvals, missing facts, and final review that need a person."],
];

export function LandingPage({
  promoActive,
  promoEndsAt,
  standardMonthly,
  foundingMonthly,
  signupHref,
  loginHref = "/login",
}: LandingPageProps) {
  const price = promoActive ? foundingMonthly : standardMonthly;

  const faq = [
    [
      "What does the AI actually do?",
      "BrostCo can gather opportunities, score fit, prepare briefs, organize requirements, coordinate outreach, capture replies, surface blockers, and help assemble bid work using your configured rules and connected services. Your dashboard shows what happened and what needs you next.",
    ],
    [
      "Does BrostCo submit bids automatically?",
      "No. BrostCo helps prepare the work, but your team keeps control of final review, signatures, attestations, and submission through the required agency channel.",
    ],
    [
      "Who is BrostCo built for?",
      "BrostCo is designed for small and mid-size government contractors that want a more capable capture and bid process without adding a large administrative team.",
    ],
    [
      "Do I need a credit card for the trial?",
      `No. The ${TRIAL_DAYS}-day trial does not require a credit card. Trial usage limits apply.`,
    ],
    [
      "Are AI and service usage included in the subscription?",
      "Subscription and service usage are separate. Supported platform services or your own eligible API keys can be used, with usage and limits visible in your account.",
    ],
    [
      "Does BrostCo replace SAM.gov?",
      "No. SAM.gov remains the official source for federal opportunities and entity registration. BrostCo organizes and moves the work around those opportunities.",
    ],
  ];

  return (
    <div className="bco-site">
      <header className="bco-nav">
        <div className="bco-container bco-nav-inner">
          <Link href="/" aria-label="BrostCo home" className="bco-brand-link">
            <Wordmark variant="light" priority className="h-7" />
          </Link>
          <nav aria-label="Primary navigation" className="bco-desktop-nav">
            <a href="#platform">Platform</a>
            <a href="#ai">AI</a>
            <a href="#workflow">How it works</a>
            <a href="#pricing">Pricing</a>
          </nav>
          <div className="bco-nav-actions">
            <Link href={loginHref} className="bco-login">Log in</Link>
            <Link href={signupHref} className="bco-button">Start free trial</Link>
            <div className="lg:hidden">
              <MarketingMobileMenu signupHref={signupHref} loginHref={loginHref} onLanding dark />
            </div>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="bco-hero-shell">
          <HeroBackgroundVideo />
          <div className="bco-hero-scrim" />
          <div className="bco-container bco-hero">
            <div className="bco-hero-copy">
              <p className="bco-kicker bco-kicker-light">AI infrastructure for government contractors</p>
              <h1>Find the work. Move the pursuit. Know what needs you.</h1>
              <p className="bco-lead bco-lead-light">
                BrostCo is an AI platform that finds matching federal opportunities, coordinates subcontractor work, prepares the bid, and brings the decisions back to you.
              </p>
              <div className="bco-actions">
                <Link href={signupHref} className="bco-button bco-button-hero">
                  Start your free trial <span aria-hidden>↗</span>
                </Link>
                <a href="#platform" className="bco-button bco-button-glass">See the platform</a>
              </div>
              <p className="bco-caption bco-caption-light">
                {TRIAL_DAYS} days free · No credit card required · Final decisions stay with your team
              </p>
            </div>
          </div>
        </section>

        <section className="bco-proof" aria-label="BrostCo capabilities">
          <div className="bco-container bco-proof-grid">
            <span>One AI workspace for the pursuit</span>
            <strong>Opportunity discovery</strong>
            <strong>Capture and review</strong>
            <strong>Subcontractor coordination</strong>
            <strong>Bid preparation</strong>
          </div>
        </section>

        <section className="bco-container bco-section bco-intro" id="platform">
          <div className="bco-section-heading bco-section-heading-wide">
            <p className="bco-kicker">One connected platform</p>
            <h2>Government contracting has too many moving parts. BrostCo keeps them together.</h2>
            <p>
              Stop jumping between opportunity lists, spreadsheets, email threads, subcontractor notes, bid files, and reminders. BrostCo keeps the pursuit connected from discovery through final review.
            </p>
          </div>
          <WorkflowGallery />
        </section>

        <section className="bco-section bco-ai" id="ai">
          <div className="bco-container">
            <div className="bco-section-heading bco-section-heading-wide">
              <p className="bco-kicker">AI built into the work</p>
              <h2>AI should reduce the workload, not give you another box to chat with.</h2>
              <p>
                BrostCo uses AI inside the workflow to analyze opportunities, organize information, prepare work, explain blockers, and surface the next action.
              </p>
            </div>
            <div className="bco-capability-grid">
              {capabilities.map(([title, copy]) => (
                <article key={title} className="bco-capability-card">
                  <span aria-hidden>✓</span>
                  <div>
                    <h3>{title}</h3>
                    <p>{copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="bco-container bco-section" id="workflow">
          <div className="bco-section-heading bco-section-heading-wide">
            <p className="bco-kicker">How it works</p>
            <h2>A simpler operating system for your federal pipeline.</h2>
          </div>
          <div className="bco-step-stack">
            {steps.map(([number, title, copy]) => (
              <article key={number}>
                <span>{number}</span>
                <div>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="bco-section bco-demo-section" id="walkthrough">
          <div className="bco-container">
            <div className="bco-tour-heading">
              <div>
                <p className="bco-kicker bco-kicker-light">See the work move</p>
                <h2>From a new opportunity to a clear next action.</h2>
              </div>
              <p>
                This walkthrough uses sample data and shows the same product surfaces customers use to review opportunities, work the queue, and prepare bids.
              </p>
            </div>
            <div className="bco-demo-frame">
              <ProductVideo
                slug="platform-walkthrough"
                poster="/demos/today-desktop.jpg"
                title="BrostCo platform walkthrough using sample data"
                className="bco-tour"
              />
            </div>
          </div>
        </section>

        <section className="bco-container bco-section bco-control-section">
          <div className="bco-control-copy">
            <p className="bco-kicker">Automation with accountability</p>
            <h2>BrostCo can do more work without hiding what happened.</h2>
            <p>
              Drafts stay drafts until they are sent. Blocked work stays visible. Sources stay attached. Activity history shows what ran, what failed, and what still needs a person.
            </p>
            <Link href={signupHref} className="bco-button">Try BrostCo free</Link>
          </div>
          <div className="bco-control-points">
            <article><strong>Source-linked decisions</strong><span>Open the record and supporting material behind the recommendation.</span></article>
            <article><strong>Visible automation</strong><span>See what is running, paused, waiting, or blocked.</span></article>
            <article><strong>Human checkpoints</strong><span>Keep final control over pursuit decisions and submission.</span></article>
            <article><strong>Recoverable errors</strong><span>When something stops, BrostCo explains the issue and points to the fix.</span></article>
          </div>
        </section>

        <section className="bco-section bco-pricing-section" id="pricing">
          <div className="bco-container bco-pricing">
            <div>
              <p className="bco-kicker">Start with a real workflow</p>
              <h2>Try the platform before you commit.</h2>
              <p>Use your free trial to set up your company, review matching opportunities, and see how BrostCo fits your process.</p>
              <Link href="/pricing-guide" className="bco-text-link">See pricing and usage details</Link>
            </div>
            <div className="bco-price-card">
              <span className="bco-plan-label">{promoActive ? "Founding plan" : "Standard plan"}</span>
              {promoActive && <p className="bco-caption">Standard rate <s>${standardMonthly.toLocaleString("en-US")}/month</s></p>}
              <p className="bco-price">${price.toLocaleString("en-US")}<span>/month</span></p>
              <p className="bco-caption">After your free trial. Service usage billed separately.</p>
              <ul>
                <li>AI opportunity discovery and fit workflow</li>
                <li>Subcontractor outreach, calls, replies, and quotes</li>
                <li>Bid requirements, pricing, documents, and review</li>
                <li>Activity history, automation health, and account controls</li>
              </ul>
              {promoActive && promoEndsAt && (
                <p className="bco-caption">Founding offer available through {new Date(promoEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} (UTC). Rate applies while continuously subscribed.</p>
              )}
              <Link href={signupHref} className="bco-button">Start your {TRIAL_DAYS}-day free trial</Link>
              <p className="bco-caption">No credit card required.</p>
            </div>
          </div>
        </section>

        <section className="bco-container bco-section bco-faq" id="faq">
          <div>
            <p className="bco-kicker">Questions</p>
            <h2>Know what you are getting before you start.</h2>
          </div>
          <div>
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>{q}<span aria-hidden>+</span></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="bco-final">
          <div className="bco-container">
            <p className="bco-kicker">Put AI to work on the pursuit</p>
            <h2>Spend less time chasing the process. Spend more time winning the right work.</h2>
            <Link href={signupHref} className="bco-button">Start free trial</Link>
            <p>{TRIAL_DAYS} days free. No credit card required.</p>
          </div>
        </section>
      </main>

      <MarketingFooter loginHref={loginHref} variant="dark" />
    </div>
  );
}
