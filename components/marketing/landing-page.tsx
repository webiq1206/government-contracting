import Link from "next/link";
import {
  MarketingShell,
  SectionHeading,
  TrialCTA,
  ProductIcon,
  FAQ,
} from "./site-shell";
import { OpportunityPreview, WorkflowDemo } from "./workflow-demo";
import { HOME_FAQ, TRIAL_COPY, USAGE_COPY } from "./site-content";
import { TRIAL_DAYS } from "@/lib/billing/catalog";

export interface LandingPageProps {
  promoActive: boolean;
  promoEndsAt: string | null;
  standardMonthly: number;
  foundingMonthly: number;
  signupHref: string;
  loginHref?: string;
}
export function LandingPage({
  promoActive,
  promoEndsAt,
  standardMonthly,
  foundingMonthly,
  signupHref,
}: LandingPageProps) {
  const price = promoActive ? foundingMonthly : standardMonthly;
  return (
    <MarketingShell signupHref={signupHref}>
      <section className="bco-hero">
        <div className="bco-container bco-hero-grid">
          <div className="bco-hero-copy">
            <p className="bco-kicker">
              <span className="bco-signal" />
              AI for federal services contractors
            </p>
            <h1>
              Find the right contracts.
              <br />
              <span>Get bids ready faster.</span>
            </h1>
            <p className="bco-lead">
              BrostCo finds matching opportunities, reads requirements,
              coordinates subcontractor quotes, and helps prepare your bid. Your
              team reviews the work and submits.
            </p>
            <div className="bco-actions">
              <Link href={signupHref} className="bco-button">
                Start free trial <span aria-hidden="true">↗</span>
              </Link>
              <Link href="/demo" className="bco-button bco-button-secondary">
                <span aria-hidden="true">▷</span> See how it works
              </Link>
            </div>
            <p className="bco-caption">{TRIAL_COPY}</p>
          </div>
          <div className="bco-hero-product">
            <div className="bco-product-label">
              <span>THE WORK, CONNECTED</span>
              <span>Powered by AI. Reviewed by you.</span>
            </div>
            <OpportunityPreview />
            <p className="bco-caption">
              A simplified product illustration. Sample data, no account
              required.
            </p>
          </div>
        </div>
      </section>
      <div className="bco-proof-strip">
        <div className="bco-container">
          <span>Built for teams doing the work</span>
          <strong>Construction</strong>
          <strong>Facilities</strong>
          <strong>Professional services</strong>
          <Link href="/security">
            Sources, history & human control <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>
      <section id="platform" className="bco-container bco-section">
        <div className="bco-heading-row">
          <SectionHeading
            eyebrow="One connected pursuit"
            title="Less chasing. More work ready for review."
          >
            Move from a promising posting to a prepared bid without rebuilding
            the context in spreadsheets, inboxes, and folders.
          </SectionHeading>
          <Link href="/platform" className="bco-text-link">
            Explore the platform ↗
          </Link>
        </div>
        <WorkflowDemo />
      </section>
      <section className="bco-tinted" id="ai">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Intelligence inside the workflow"
            title="AI does the preparation. You bring the judgment."
          >
            Each step produces something useful: a fit explanation, a working
            brief, a tracked conversation, or a draft ready to check.
          </SectionHeading>
          <div className="bco-card-grid">
            <article className="bco-card">
              <ProductIcon kind="source" />
              <h3>From documents to decisions</h3>
              <p>
                AI reads and organizes the requirements. Review the brief with
                the supporting source nearby.
              </p>
              <span className="bco-card-result">
                Less manual reading and re-entry
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="people" />
              <h3>From replies to next steps</h3>
              <p>
                Keep outreach and follow-ups connected to each trade. Unclear
                replies come back to your team.
              </p>
              <span className="bco-card-result">
                Fewer loose ends before the deadline
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="check" />
              <h3>From scattered files to a bid</h3>
              <p>
                Bring scope, quotes, and draft documents together. See what is
                missing before final review.
              </p>
              <span className="bco-card-result">
                A clearer path to a complete package
              </span>
            </article>
          </div>
          <div className="bco-section-links">
            <Link href="/ai" className="bco-text-link">
              See what AI does and what you control ↗
            </Link>
            <Link href="/subcontractors" className="bco-text-link">
              Explore subcontractor coordination ↗
            </Link>
          </div>
        </div>
      </section>
      <section id="workflow" className="bco-container bco-section bco-split">
        <SectionHeading
          eyebrow="Fits the way your team works"
          title="Start with your company. End with a clear next action."
        >
          BrostCo works around your pursuit rules, connected services, and human
          review.
        </SectionHeading>
        <ol className="bco-steps">
          <li>
            <span>01</span>
            <div>
              <h3>Set the direction</h3>
              <p>
                Add your services, service area, qualifications, and target
                work. Connect the services your workflow needs.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Let the workflow do its part</h3>
              <p>
                AI and connected services gather opportunities, prepare
                analysis, and progress configured outreach and bid work.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Review what needs you</h3>
              <p>
                Open Today for decisions, replies, calls, and blockers. Your
                team checks the bid and submits.
              </p>
              <Link href="/get-started" className="bco-text-link">
                See the setup checklist ↗
              </Link>
            </div>
          </li>
        </ol>
      </section>
      <section id="walkthrough" className="bco-dark-section">
        <div className="bco-container bco-section bco-split">
          <div>
            <p className="bco-kicker">Look inside before you sign up</p>
            <h2>A product you can explore.</h2>
            <p>
              Follow one sample opportunity through the interactive walkthrough,
              then watch the actual workspace in action. No email gate.
            </p>
            <div className="bco-actions">
              <Link href="/demo" className="bco-button">
                Open the product tour ↗
              </Link>
              <Link href="/demo#recordings" className="bco-text-link">
                Watch the 2-minute walkthrough
              </Link>
            </div>
          </div>
          <div className="bco-evidence-list">
            <article>
              <ProductIcon kind="source" />
              <div>
                <h3>Check the source</h3>
                <p>Review original records alongside AI-generated work.</p>
              </div>
            </article>
            <article>
              <ProductIcon kind="clock" />
              <div>
                <h3>See what happened</h3>
                <p>
                  Trace drafts, messages, replies, and completed or blocked
                  actions.
                </p>
              </div>
            </article>
            <article>
              <ProductIcon kind="shield" />
              <div>
                <h3>Keep control</h3>
                <p>
                  Review your rules and connected services. Final submission
                  stays with you.
                </p>
                <Link href="/security" className="bco-text-link">
                  Security & data practices ↗
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>
      <section id="pricing" className="bco-container bco-section bco-split">
        <SectionHeading
          eyebrow="Clear pricing. A practical trial."
          title="Try a real workflow before you subscribe."
        >
          Use your {TRIAL_DAYS}-day trial to build a profile and review matching
          work. Supported trial services have usage limits.
        </SectionHeading>
        <article className="bco-price-card">
          <p className="bco-kicker">
            {promoActive ? "Founding" : "Standard"} / Full platform
          </p>
          <p className="bco-price">
            ${price.toLocaleString("en-US")}
            <span>/month</span>
          </p>
          <p>
            Subscription after you choose paid access. Service usage is
            additional.
          </p>
          <ul className="bco-check-list">
            <li>Opportunity discovery and AI analysis</li>
            <li>Subcontractor outreach and quote tracking</li>
            <li>Bid preparation, review, and activity history</li>
          </ul>
          {promoActive && (
            <p className="bco-caption">
              Standard ${standardMonthly.toLocaleString("en-US")}/month.
              Founding eligibility applies
              {promoEndsAt
                ? ` through ${new Date(promoEndsAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`
                : ""}
              .
            </p>
          )}
          <Link href={signupHref} className="bco-button">
            Start free trial ↗
          </Link>
          <Link href="/pricing-guide" className="bco-text-link">
            Monthly, annual & usage details
          </Link>
          <p className="bco-caption">{USAGE_COPY}</p>
        </article>
      </section>
      <section id="faq" className="bco-container bco-section bco-faq-section">
        <SectionHeading
          eyebrow="Before you begin"
          title="A few things worth knowing."
        />
        <FAQ items={HOME_FAQ} />
      </section>
      <TrialCTA signupHref={signupHref} />
    </MarketingShell>
  );
}
