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
import { HomepageFeatureChapter, HomepageQuickPreview } from "./homepage-feature-videos";
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
            AI finds matches, organizes requirements, coordinates quotes, and
            prepares bid drafts. Set your rules, choose your automation, and
            keep the final review.
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
      <section id="platform" className="bco-container bco-section bco-discovery-section">
        <HomepageFeatureChapter chapter="discover" />
        <div className="bco-explore-more">
          <HomepageQuickPreview />
          <details className="bco-workflow-explorer" id="interactive-workflow">
            <summary><span aria-hidden="true">↳</span> Try the workflow, step by step <span aria-hidden="true">+</span></summary>
            <WorkflowDemo />
          </details>
        </div>
        <p className="bco-tour-note">Recorded tours use sample records, staged AI outputs, and sample message history. No external messages or bids are sent.</p>
      </section>
      <section className="bco-coordination-section" id="ai">
        <div className="bco-container bco-section">
          <HomepageFeatureChapter chapter="coordinate" />
        </div>
      </section>
      <section id="bid-review" className="bco-container bco-section bco-preparation-section">
        <HomepageFeatureChapter chapter="prepare" />
        <div className="bco-chapter-next">
          <p>Your next opportunity deserves a better workflow.</p>
          <Link href={signupHref} className="bco-button">Start free trial <span aria-hidden="true">↗</span></Link>
        </div>
      </section>
      <IndustrySlider />
      <section id="workflow" className="bco-container bco-section bco-split">
        <SectionHeading
          sticky
          eyebrow="Make your first week count"
          title="Your first week, with a clear plan."
        >
          Start with discovery. Add automation as you go. Your progress depends
          on setup, available opportunities, and subcontractor replies.
        </SectionHeading>
        <ol className="bco-steps">
          <li>
            <span>01</span>
            <div>
              <p className="bco-kicker">Day 1 / Set your direction</p>
              <h3>Point AI toward the right work.</h3>
              <p>
                Add your services, locations, and qualifications. Set your pursuit
                rules and connect opportunity discovery.
              </p>
              <p className="bco-week-outcome"><strong>Your checkpoint:</strong> A company profile and matching criteria you can inspect.</p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <p className="bco-kicker">Days 2 to 3 / Put it to work</p>
              <h3>Turn a match into a plan.</h3>
              <p>
                Review a match and its requirements. Need subcontractor quotes?
                Connect your inbox and choose your outreach rules.
              </p>
              <p className="bco-week-outcome"><strong>Your checkpoint:</strong> Requirements organized, with optional outreach configured.</p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <p className="bco-kicker">Days 4 to 7 / Review the work</p>
              <h3>Review the work. Make your next move.</h3>
              <p>
                Check replies, pricing, and any missing inputs. When the required
                inputs are ready, review your draft bid. Today shows the calls
                and decisions that still need you.
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
