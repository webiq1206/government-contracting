import { publicMetadata } from "@/lib/marketing/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
} from "@/components/marketing/site-shell";
import { TRIAL_DAYS } from "@/lib/billing/catalog";
export const metadata: Metadata = publicMetadata(
  "Start your trial and review your first opportunity",
  "What to have ready for your free BrostCo trial: company profile, SAM.gov access, supported AI services, and a mailbox for outreach.",
  "/get-started",
);
export default function GetStartedPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Getting started"
        title="Your first goal: one opportunity you understand."
        copy={`Use your ${TRIAL_DAYS}-day trial to set up your company and review a real pursuit. No credit card is required to create your trial account.`}
      />
      <section className="bco-container bco-section bco-split">
        <div>
          <SectionHeading title="A little setup. A useful first result.">
            Bring your company details and access to the services you want to
            connect. You can review the product tour before creating an account.
          </SectionHeading>
          <Link href="/demo" className="bco-text-link">
            Explore without signing up ↗
          </Link>
        </div>
        <ol className="bco-steps">
          <li>
            <span>01</span>
            <div>
              <h3>Create your workspace</h3>
              <p>
                Register your account and add your company details. Have your
                services, service area, NAICS codes, and registration
                information ready.
              </p>
            </div>
          </li>
          <li>
            <span>02</span>
            <div>
              <h3>Connect the work</h3>
              <p>
                Set up SAM.gov access for discovery, or start with a supported
                notice link or PDF import. Choose supported AI services.
                Mailbox and sender setup are needed before outreach, not for
                simply reading and reviewing an opportunity.
              </p>
            </div>
          </li>
          <li>
            <span>03</span>
            <div>
              <h3>Review one opportunity</h3>
              <p>
                Check its fit, open the source, and review the requirements.
                Confirm the pursuit rules before enabling background actions.
              </p>
            </div>
          </li>
          <li>
            <span>04</span>
            <div>
              <h3>Work toward a prepared bid</h3>
              <p className="bco-caption">Next, when you are ready to pursue</p>
              <p>
                Find subcontractors, review quote coverage, and bring the bid
                inputs together. Use Today to see decisions, calls, and missing
                information.
              </p>
            </div>
          </li>
        </ol>
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Connections, explained"
            title="Know what you need before you start."
          />
          <div className="bco-card-grid">
            <article className="bco-card">
              <p className="bco-kicker">Opportunity discovery</p>
              <h3>SAM.gov access</h3>
              <p>
                SAM.gov remains the official source. Setup shows the key and
                access needed for your account&apos;s discovery workflow.
                Registration and agency requirements remain your responsibility.
              </p>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">Analysis and lookup</p>
              <h3>Supported services</h3>
              <p>
                Trial access can use supported platform services within usage
                limits. For paid use, choose available platform services with
                usage billing or eligible keys of your own.
              </p>
              <Link href="/pricing-guide#usage" className="bco-text-link">
                Understand service costs ↗
              </Link>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">Subcontractor outreach</p>
              <h3>Your connected mailbox</h3>
              <p>
                Connect the mailbox you use for outreach, complete your sender
                identity, and review sending rules. Your team resolves unclear
                replies and makes calls when needed.
              </p>
            </article>
          </div>
        </div>
      </section>
      <section className="bco-container bco-section">
        <div className="bco-note">
          <strong>At the end of the trial</strong>
          <p>
            Your no-card trial does not automatically turn into a paid
            subscription. Choose a plan and complete checkout to continue with
            paid access. Service usage is separate, and available connections
            and limits are shown in your account.
          </p>
          <p>
            Need help with setup?{" "}
            <a href="mailto:hello@brostco.com">Contact hello@brostco.com</a>.
          </p>
        </div>
      </section>
      <TrialCTA title="Start with your company and one pursuit." />
    </MarketingShell>
  );
}
