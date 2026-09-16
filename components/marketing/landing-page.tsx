import Link from "next/link";
import {
  MarketingShell,
  SectionHeading,
  TrialCTA,
  ProductIcon,
  FAQ,
} from "./site-shell";
import { WorkflowDemo } from "./workflow-demo";
import { HOME_FAQ, USAGE_COPY } from "./site-content";
import { IndustrySlider } from "./industry-slider";
import { ProductEvidence } from "./product-evidence";
import { HeroBackgroundVideo } from "./hero-background-video";
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
            Find government contracts.
            <br />
            <span>Let AI prepare the bid.</span>
          </h1>
          <p className="bco-lead">
            BrostCo finds matching work, contacts subcontractors, and drafts
            your bids. You handle calls, decisions, and final review.
          </p>
          <div className="bco-actions">
            <Link href={signupHref} className="bco-button">
              Start free trial <span aria-hidden="true">→</span>
            </Link>
          </div>
          <p className="bco-caption">
            {TRIAL_DAYS} days free. No credit card required.
          </p>
          <Link href="#platform" className="bco-hero-tour">
            See how it works <span aria-hidden="true">↓</span>
          </Link>
        </div>
      </section>
      <div className="bco-value-strip" aria-label="How BrostCo fits your work">
        <div className="bco-container">
          <p>For small and mid-size government contractors</p>
          <span>Your rules</span>
          <span>Your connected inbox</span>
          <span>Your final approval</span>
        </div>
      </div>
      <section id="platform" className="bco-container bco-section">
        <div className="bco-heading-row">
          <SectionHeading
            eyebrow="From opportunity to a prepared bid"
            title="The routine work, handled. The decisions, yours."
          >
            No more piecing together postings, documents, and email threads.
            See how AI moves the work forward under your rules.
          </SectionHeading>
          <Link href="/platform" className="bco-text-link">
            Explore the platform ↗
          </Link>
        </div>
        <WorkflowDemo />
      </section>
      <IndustrySlider />
      <section className="bco-tinted" id="ai">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="More than bid alerts or an AI writing tool"
            title="One pursuit. Everything connected."
          >
            Discovery leads to analysis. Analysis guides outreach. Quotes feed
            the bid. Your team picks up the work with the context already attached.
          </SectionHeading>
          <div className="bco-card-grid">
            <article className="bco-card">
              <ProductIcon kind="source" />
              <h3>Find work worth pursuing</h3>
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
              <h3>Stop chasing every reply</h3>
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
              <h3>Review without the rebuild</h3>
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
            <Link href="/compare" className="bco-text-link">
              Compare with your current workflow ↗
            </Link>
          </div>
        </div>
      </section>
      <section id="workflow" className="bco-container bco-section bco-split">
        <SectionHeading
          sticky
          eyebrow="A clear path to your first opportunity"
          title="Set it up. Put it to work. Stay in control."
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
      <ProductEvidence signupHref={signupHref} />
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
          title="Straight answers before you start."
        />
        <FAQ items={HOME_FAQ} />
      </section>
      <TrialCTA signupHref={signupHref} />
    </MarketingShell>
  );
}
