import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { MarketingMobileMenu } from "./mobile-menu";
import { MarketingFooter } from "./marketing-footer";
import { WorkflowGallery } from "./workflow-gallery";
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
const steps = [
  [
    "Find your fit",
    "Matching federal opportunities, organized around your company.",
    "01",
  ],
  [
    "Build your team",
    "Subcontractor outreach, follow-ups, and quotes connected to the pursuit.",
    "02",
  ],
  [
    "Prepare your bid",
    "Requirements, pricing, and documents brought together for review.",
    "03",
  ],
  [
    "Make the decision",
    "A clear next step, with your team in control of final submission.",
    "04",
  ],
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
      "Who is BrostCo for?",
      "BrostCo helps small and mid-size federal services contractors organize opportunities, coordinate subcontractors, and prepare bid packages without a large capture team.",
    ],
    [
      "What happens automatically?",
      "BrostCo can gather opportunities, score fit, prepare briefs, coordinate outreach, and assemble bid materials using your connected services and configured rules. The dashboard shows what is running and what needs you.",
    ],
    [
      "Does BrostCo submit bids for me?",
      "No. Your team handles final review, signatures, attestations, and submission through the agency’s required channel.",
    ],
    [
      "What do I need to get started?",
      "Create your account, add your company profile, and connect the services your workflow needs. Setup shows required connections and lets you return to optional steps later.",
    ],
    [
      "Are AI and service costs included?",
      "The subscription and service usage are separate. You can use your own supported API keys or eligible platform-provided services. Platform usage is billable, with usage and limits visible in your account. Check Billing for your account’s terms.",
    ],
    [
      "Does this replace SAM.gov?",
      "No. SAM.gov remains the official source for federal opportunities and entity registration. BrostCo organizes the work around those opportunities.",
    ],
    [
      "How does the free trial work?",
      `Your ${TRIAL_DAYS}-day trial requires no credit card. Trial usage limits apply. Choose a paid plan to continue after the trial; a subscription does not guarantee a contract award.`,
    ],
  ];
  return (
    <div className="bco-site">
      <header className="bco-nav">
        <div className="bco-container bco-nav-inner">
          <Link href="/" aria-label="BrostCo home">
            <Wordmark variant="dark" priority className="h-7" />
          </Link>
          <nav aria-label="Primary navigation" className="bco-desktop-nav">
            <a href="#platform">Product</a>
            <a href="#workflow">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">Questions</a>
          </nav>
          <div className="bco-nav-actions">
            <Link href={loginHref} className="bco-login">
              Log in
            </Link>
            <Link href={signupHref} className="bco-button">
              Start free trial
            </Link>
            <div className="lg:hidden">
              <MarketingMobileMenu
                signupHref={signupHref}
                loginHref={loginHref}
                onLanding
              />
            </div>
          </div>
        </div>
      </header>
      <main id="top">
        <section className="bco-container bco-hero">
          <div className="bco-hero-copy">
            <p className="bco-kicker">AI for government contracting</p>
            <h1>
              More opportunity.
              <br />
              <span>Less busywork.</span>
            </h1>
            <p className="bco-lead">
              Find the right federal work, coordinate subcontractors, and
              prepare bids in one place. BrostCo moves the work forward. You
              make the decisions.
            </p>
            <div className="bco-actions">
              <Link href={signupHref} className="bco-button">
                Start your free trial <span aria-hidden>↗</span>
              </Link>
              <a
                href="#walkthrough"
                className="bco-button bco-button-secondary"
              >
                <span aria-hidden>▷</span> See how it works
              </a>
            </div>
            <p className="bco-caption">
              {TRIAL_DAYS} days free · No credit card required · Your team keeps
              control
            </p>
          </div>
          <div className="bco-hero-product">
            <div className="bco-preview-label">
              <span>One place to move work forward</span>
              <span>Product preview</span>
            </div>
            <video
              controls
              playsInline
              muted
              preload="none"
              poster="/demos/today-desktop.jpg"
              aria-label="BrostCo Today: guided screen preview using sample data"
              width="1440"
              height="960"
            >
              <source src="/demos/hero-preview.mp4" type="video/mp4" />
              <track kind="captions" src="/demos/hero-preview.vtt" srcLang="en" label="English" default />
              Read the <a href="/demos/hero-preview.txt">preview transcript</a>.
            </video>
            <div className="bco-preview-footer">
              <span>Know what needs you.</span>
              <a href="#platform">
                Explore the workflow <span aria-hidden>↗</span>
              </a>
            </div>
          </div>
        </section>
        <div className="bco-proof">
          <div className="bco-container">
            <span>Built around the work of federal contractors</span>
            <strong>Opportunity discovery</strong>
            <strong>Subcontractor coordination</strong>
            <strong>Bid preparation</strong>
            <strong>Human oversight</strong>
          </div>
        </div>
        <section className="bco-container bco-section" id="platform">
          <div className="bco-section-heading">
            <p className="bco-kicker">The connected workflow</p>
            <h2>
              From a good opportunity
              <br />
              to a clear next step.
            </h2>
            <p>
              Everything stays with the pursuit. Open the details when you need
              them, then get back to the work.
            </p>
          </div>
          <WorkflowGallery />
        </section>
        <section className="bco-section bco-workflow" id="workflow">
          <div className="bco-container">
            <div className="bco-section-heading">
              <p className="bco-kicker">How it works</p>
              <h2>
                A lot happens.
                <br />
                You see what matters.
              </h2>
              <p>
                Your profile and rules guide the work. Your dashboard brings
                decisions, deadlines, and exceptions to the surface.
              </p>
            </div>
            <div className="bco-steps">
              {steps.map(([title, description, number]) => (
                <article key={title}>
                  <span className="bco-step-number">{number}</span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="bco-container bco-section" id="walkthrough">
          <div className="bco-tour-heading">
            <div>
              <p className="bco-kicker">See the product</p>
              <h2>
                Your next pursuit,
                <br />
                from the inside.
              </h2>
            </div>
            <p>
              A guided screen preview of the workspace using sample data.
              Follow the work from your daily queue to the record and its
              supporting information.
            </p>
          </div>
          <video
            className="bco-tour"
            controls
            playsInline
            preload="none"
            poster="/demos/today-desktop.jpg"
            aria-label="BrostCo platform: guided screen preview using sample data"
          >
            <source src="/demos/platform-walkthrough.mp4" type="video/mp4" />
            <track
              kind="captions"
              src="/demos/platform-walkthrough.vtt"
              srcLang="en"
              label="English"
              default
            />
            Your browser does not support video. Read the walkthrough transcript
            below.
          </video>
          <a className="bco-text-link" href="/demos/platform-walkthrough.txt">
            Read the walkthrough transcript
          </a>
        </section>
        <section className="bco-control bco-section" id="pipeline">
          <div className="bco-container bco-control-grid">
            <div>
              <p className="bco-kicker">AI does the legwork</p>
              <h2>
                Your judgment
                <br />
                stays in the loop.
              </h2>
              <p>
                Automation is useful when you can understand it. See what
                happened, inspect the source, and step in when your team is
                needed.
              </p>
              <Link href={signupHref} className="bco-button">
                Put BrostCo to work <span aria-hidden>↗</span>
              </Link>
            </div>
            <div className="bco-control-list">
              {[
                [
                  "See why it matters",
                  "Open an opportunity’s fit, requirements, deadline, and supporting documents before committing.",
                ],
                [
                  "Keep relationships moving",
                  "Track outreach, replies, calls, and quotes with the opportunity they belong to.",
                ],
                [
                  "Know what ran",
                  "Follow actions and results in your activity history. Open the exact item that needs attention.",
                ],
                [
                  "Keep final control",
                  "Review bid materials and resolve missing information. Your team handles final submission.",
                ],
              ].map(([title, copy]) => (
                <article key={title}>
                  <h3>{title}</h3>
                  <p>{copy}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
        <section className="bco-container bco-section" id="pricing">
          <div className="bco-pricing">
            <div>
              <p className="bco-kicker">Clear pricing</p>
              <h2>
                A workspace for
                <br />
                your next stage.
              </h2>
              <p>
                Start with your company and a real pursuit. See how the pieces
                fit before choosing a plan.
              </p>
              <Link href="/pricing-guide" className="bco-text-link">
                Explore pricing and usage
              </Link>
            </div>
            <div className="bco-price-card">
              <span className="bco-plan-label">
                {promoActive ? "Founding plan" : "Standard plan"}
              </span>
              {promoActive && (
                <p className="bco-caption">
                  Standard rate{" "}
                  <s>${standardMonthly.toLocaleString("en-US")}/month</s>
                </p>
              )}
              <p className="bco-price">
                ${price.toLocaleString("en-US")}
                <span>/month</span>
              </p>
              <p className="bco-caption">
                After your free trial. Service usage billed separately.
              </p>
              <ul>
                <li>Opportunity pipeline and daily work queue</li>
                <li>Subcontractors, outreach, and bid preparation</li>
                <li>Activity history, automation controls, and reports</li>
              </ul>
              {promoActive && promoEndsAt && (
                <p className="bco-caption">
                  Founding offer available through{" "}
                  {new Date(promoEndsAt).toLocaleDateString("en-US", {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                    timeZone: "UTC",
                  })}{" "}
                  (UTC). Rate applies while continuously subscribed.
                </p>
              )}
              <Link href={signupHref} className="bco-button">
                Start your {TRIAL_DAYS}-day free trial{" "}
                <span aria-hidden>↗</span>
              </Link>
              <p className="bco-caption">No credit card required to try it.</p>
            </div>
          </div>
        </section>
        <section className="bco-container bco-section bco-faq" id="faq">
          <div>
            <p className="bco-kicker">A few useful answers</p>
            <h2>
              Before you
              <br />
              get started.
            </h2>
          </div>
          <div>
            {faq.map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <span aria-hidden>+</span>
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
        <section className="bco-final">
          <div className="bco-container">
            <p className="bco-kicker">Make room for the work that matters</p>
            <h2>
              Your next opportunity.
              <br />A clearer way forward.
            </h2>
            <Link href={signupHref} className="bco-button">
              Start free trial <span aria-hidden>↗</span>
            </Link>
            <p>{TRIAL_DAYS} days free. No credit card required.</p>
          </div>
        </section>
      </main>
      <MarketingFooter loginHref={loginHref} />
    </div>
  );
}
