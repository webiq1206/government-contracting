import { publicMetadata } from "@/lib/marketing/metadata";
import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
} from "@/components/marketing/site-shell";
export const metadata: Metadata = publicMetadata(
  "About our government contracting platform",
  "BrostCo is an AI platform operated by BROSTCO HOLDINGS LLC for federal services contractors who need a more connected pursuit and bid workflow.",
  "/about",
);
export default function AboutPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="About BrostCo"
        title="Built around the work between opportunity and bid."
        copy="BrostCo is an AI platform for small and mid-size federal services contractors. It connects opportunity discovery, subcontractor coordination, and bid preparation so the team can spend more attention on the decisions that need them."
      />
      <section className="bco-container bco-section bco-split">
        <SectionHeading title="The middle of the process matters.">
          A promising posting still needs a clear scope, qualified partners,
          returned quotes, pricing, and documents. BrostCo brings that work into
          one connected workflow.
        </SectionHeading>
        <div>
          <p className="bco-lead">
            Our product direction is practical: prepare useful work, make the
            next action clear, and leave the reasoning and record available for
            review.
          </p>
          <Link href="/platform" className="bco-text-link">
            Explore the platform ↗
          </Link>
        </div>
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <div className="bco-card-grid">
            <article className="bco-card">
              <p className="bco-kicker">Company</p>
              <h3>BROSTCO HOLDINGS LLC</h3>
              <p>
                The company operating BrostCo. For product, account, privacy, or
                security questions, reach our team directly.
              </p>
              <a href="mailto:hello@brostco.com" className="bco-text-link">
                hello@brostco.com ↗
              </a>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">Product evidence</p>
              <h3>Explore before you commit</h3>
              <p>
                Use the interactive example and guided product walkthroughs to
                evaluate how BrostCo fits your process.
              </p>
              <Link href="/demo" className="bco-text-link">
                Open the product tour ↗
              </Link>
            </article>
            <article className="bco-card">
              <p className="bco-kicker">Clear expectations</p>
              <h3>Know what you control</h3>
              <p>
                Review how AI is used, which work depends on your setup, and
                what remains your team&apos;s responsibility.
              </p>
              <Link href="/security" className="bco-text-link">
                Security & data practices ↗
              </Link>
            </article>
          </div>
        </div>
      </section>
      <div className="bco-container bco-section">
        <p className="bco-note">
          BrostCo is a software provider. SAM.gov and agency portals remain the
          official sources for registration, opportunities, and submission
          requirements. BrostCo does not guarantee contract awards.
        </p>
      </div>
      <TrialCTA />
    </MarketingShell>
  );
}
