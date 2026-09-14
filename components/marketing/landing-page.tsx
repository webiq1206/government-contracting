import Link from "next/link";
import {
  MarketingShell,
  SectionHeading,
  TrialCTA,
  ProductIcon,
  FAQ,
} from "./site-shell";
import { WorkflowDemo } from "./workflow-demo";
import { HOME_FAQ, TRIAL_COPY, USAGE_COPY } from "./site-content";
import { IndustrySlider } from "./industry-slider";
import { CustomerStories } from "./customer-stories";
import { HeroBackgroundVideo } from "./hero-background-video";
import { StickyColumn } from "./sticky-column";
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
    <MarketingShell signupHref={signupHref} darkHeader>
      <section className="bco-hero bco-hero-centered">
        <HeroBackgroundVideo />
        <div className="bco-container bco-hero-center-content">
          <p className="bco-kicker">AI Government Procurement Platform</p>
          <h1>
            AI that finds government contracts
            <br />
            <span>and prepares your bids.</span>
          </h1>
          <p className="bco-lead">
            BrostCo reads solicitations, coordinates subcontractors, follows up,
            and assembles bid documents. Set your rules and let AI run the
            routine work. You handle calls, exceptions, and final review.
          </p>
          <div className="bco-actions">
            <Link href={signupHref} className="bco-button">
              Start free trial <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="bco-caption">{TRIAL_COPY}</p>
          <Link href="#platform" className="bco-hero-tour">
            See AI at work <span aria-hidden="true">↓</span>
          </Link>
        </div>
      </section>
      <IndustrySlider />
      <section id="platform" className="bco-container bco-section">
        <div className="bco-heading-row">
          <SectionHeading
            eyebrow="From setup to work done"
            title="BrostCo does the preparation and follow-through."
          >
            Set your company profile, connect your services, and choose your
            automation rules. AI runs the routine work. Your team handles the
            decisions.
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
            eyebrow="Built around your business"
            title="One connected workflow. Fewer tools to manage."
          >
            Your company profile, conversations, and bid work stay connected.
            The next step starts with the context it needs.
          </SectionHeading>
          <div className="bco-card-grid">
            <article className="bco-card">
              <ProductIcon kind="source" />
              <h3>Your company guides the AI</h3>
              <p>
                Your services, qualifications, location, and pursuit rules guide
                opportunity matching and the work that follows.
              </p>
              <span className="bco-card-result">
                Relevant work from the start
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="people" />
              <h3>Your inbox carries the conversation</h3>
              <p>
                Quote requests and follow-ups use your connected mailbox.
                Replies stay attached to the subcontractor and opportunity.
              </p>
              <span className="bco-card-result">
                Follow-through without rebuilding each thread
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="check" />
              <h3>Your work comes with a history</h3>
              <p>
                See the analysis, messages, quotes, and documents behind each
                action. Open the supporting work when a decision needs you.
              </p>
              <span className="bco-card-result">
                Context ready when you need it
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
          sticky
          eyebrow="Fits the way your team works"
          title="Set the direction. Let AI take it from there."
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
              <h3>Let AI run the routine work</h3>
              <p>
                BrostCo finds matches, analyzes documents, sends outreach,
                follows up, and drafts bid work under your rules.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Review what needs you</h3>
              <p>
                Open Today for calls, exceptions, and final reviews. Confirm
                pricing and contract terms, sign, and submit.
              </p>
              <Link href="/get-started" className="bco-text-link">
                See the setup checklist ↗
              </Link>
            </div>
          </li>
        </ol>
      </section>
      <CustomerStories />
      <section id="walkthrough" className="bco-dark-section">
        <div className="bco-container bco-section bco-split">
          <StickyColumn>
            <p className="bco-kicker">Look inside before you sign up</p>
            <h2>A product you can explore.</h2>
            <p>
              Follow one sample opportunity through the interactive walkthrough,
              then explore guided previews of the product screens. No email
              gate.
            </p>
            <div className="bco-actions">
              <Link href="/demo" className="bco-button">
                Open the product tour ↗
              </Link>
              <Link href="/demo#recordings" className="bco-text-link">
                Watch the 2-minute walkthrough
              </Link>
            </div>
          </StickyColumn>
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
          sticky
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
          sticky
          eyebrow="Before you begin"
          title="A few things worth knowing."
        />
        <FAQ items={HOME_FAQ} />
      </section>
      <TrialCTA signupHref={signupHref} />
    </MarketingShell>
  );
}
