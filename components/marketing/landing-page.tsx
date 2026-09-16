import Link from "next/link";
import {
  MarketingShell,
  SectionHeading,
  TrialCTA,
  FAQ,
} from "./site-shell";
import { WorkflowDemo } from "./workflow-demo";
import { HOME_FAQ, USAGE_COPY } from "./site-content";
import { IndustrySlider } from "./industry-slider";
import { ProductEvidence } from "./product-evidence";
import { HeroBackgroundVideo } from "./hero-background-video";
import { IndustryRibbon } from "./industry-ribbon";
import { HomepageFeatureVideo, HomepageQuickPreview } from "./homepage-feature-videos";
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
            AI finds government contracts{" "}
            <br />
            <span>and prepares your bids.</span>
          </h1>
          <p className="bco-lead">
            From opportunity scoring to optional subcontractor outreach, quote
            capture, and bid assembly. Your rules. Your calls and final review.
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
      <IndustryRibbon />
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
        <HomepageQuickPreview />
        <WorkflowDemo />
        <div className="bco-feature-intro">
          <p className="bco-kicker">See discovery and review in the workspace</p>
          <p>These recorded tours use sample records, staged AI outputs, and sample message history. No external messages or bids are sent.</p>
        </div>
        <div className="bco-feature-video-grid" aria-label="Opportunity discovery and review videos">
          <HomepageFeatureVideo slug="pipeline" />
          <HomepageFeatureVideo slug="review" />
        </div>
      </section>
      <IndustrySlider />
      <section className="bco-tinted" id="ai">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Coordinate the people and the replies"
            title="The right team. The whole conversation."
          >
            Keep subcontractors, quotes, and conversations attached to the pursuit.
            Enable outreach and follow-ups under your rules, or perform the work
            with your own team.
          </SectionHeading>
          <div className="bco-feature-video-grid" aria-label="Subcontractor coordination and conversation videos">
            <HomepageFeatureVideo slug="subs" />
            <HomepageFeatureVideo slug="communications" />
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
      <section id="bid-review" className="bco-container bco-section">
        <SectionHeading
          eyebrow="Prepare the bid. Keep the final say."
          title="The numbers and the history, ready to review."
        >
          See pricing alongside the work that supports it. Follow the activity
          behind each update before your team makes the final call.
        </SectionHeading>
        <div className="bco-feature-video-grid" aria-label="Bid preparation and activity videos">
          <HomepageFeatureVideo slug="opportunity" />
          <HomepageFeatureVideo slug="activity" />
        </div>
        <div className="bco-section-links">
          <Link href={signupHref} className="bco-button">Start free trial ↗</Link>
          <Link href="#walkthrough" className="bco-text-link">Watch the complete workflow ↗</Link>
        </div>
      </section>
      <section id="workflow" className="bco-container bco-section bco-split">
        <SectionHeading
          sticky
          eyebrow="Make your first week count"
          title="From setup to work ready for review."
        >
          A practical plan for your seven-day trial. Start with discovery, then
          enable the automation you want. Progress depends on your setup,
          available opportunities, and subcontractor replies.
        </SectionHeading>
        <ol className="bco-steps">
          <li>
            <span>01</span>
            <div>
              <p className="bco-kicker">Day 1 / Set your direction</p>
              <h3>Give AI the context to find your work.</h3>
              <p>
                Add your services, locations, qualifications, and pursuit rules.
                Connect discovery so AI can find and score matching contracts.
              </p>
              <p className="bco-week-outcome"><strong>Your checkpoint:</strong> A company profile and matching criteria you can inspect.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <p className="bco-kicker">Days 2 to 3 / Put it to work</p>
              <h3>Move from a posting to a clear plan.</h3>
              <p>
                Review a match and its requirement brief. If you want help
                sourcing quotes, connect your inbox and enable subcontractor
                outreach and follow-ups under your rules.
              </p>
              <p className="bco-week-outcome"><strong>Your checkpoint:</strong> Requirements organized, with optional outreach configured.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <p className="bco-kicker">Days 4 to 7 / Review the work</p>
              <h3>See what AI handled. Decide what comes next.</h3>
              <p>
                Inspect captured replies and pricing. When required inputs are
                available, review the assembled draft and requirement checks.
                Today separates completed work from calls and decisions that need you.
              </p>
              <p className="bco-week-outcome"><strong>Your checkpoint:</strong> A clear view of progress, missing inputs, and your next action.</p>
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
