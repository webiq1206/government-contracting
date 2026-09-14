import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
  ProductIcon,
} from "@/components/marketing/site-shell";
import { WorkflowDemo } from "@/components/marketing/workflow-demo";
import { WORKFLOW_STAGES } from "@/components/marketing/site-content";
export const metadata: Metadata = {
  title: "The AI platform for your federal bid workflow",
  description:
    "Discover matching opportunities, read requirements, coordinate subcontractors, and prepare bids in one connected BrostCo workflow.",
  alternates: { canonical: "/platform" },
};
export default function PlatformPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Platform"
        title="AI moves the pursuit from discovery to draft."
        copy="After setup, BrostCo finds matching opportunities, analyzes requirements, coordinates subcontractor outreach, and prepares bid work under your rules. Your team handles calls, exceptions, final review, and submission."
      />
      <section className="bco-container bco-section">
        <WorkflowDemo />
        <div className="bco-subnav">
          <Link href="/subcontractors">Subcontractor coordination ↗</Link>
          <Link href="/ai">How AI works ↗</Link>
          <Link href="/demo#recordings">Guided product walkthroughs ↗</Link>
        </div>
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Capabilities, with a purpose"
            title="The work behind a prepared bid."
          />
          {WORKFLOW_STAGES.map((stage, i) => (
            <article className="bco-detail-row" key={stage.label}>
              <div>
                <p className="bco-kicker">
                  0{i + 1} / {stage.label}
                </p>
                <h3>{stage.title}</h3>
              </div>
              <div>
                <p>{stage.copy}</p>
                <p>
                  <strong>For your team:</strong> {stage.benefit}
                </p>
                <p>
                  <strong>Your review:</strong> {stage.human}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="bco-container bco-section">
        <SectionHeading
          eyebrow="Beyond a list of opportunities"
          title="Keep the pursuit connected."
        />
        <div className="bco-card-grid">
          <article className="bco-card">
            <ProductIcon kind="people" />
            <h3>People and conversations</h3>
            <p>
              Keep subcontractor details, outreach, replies, calls, and quotes
              connected to the opportunity they support.
            </p>
            <Link href="/subcontractors" className="bco-text-link">
              See the coordination workflow ↗
            </Link>
          </article>
          <article className="bco-card">
            <ProductIcon kind="source" />
            <h3>Documents and requirements</h3>
            <p>
              Work with source materials, extracted requirements, pricing, and
              draft bid documents in the same pursuit.
            </p>
            <Link href="/demo#recordings" className="bco-text-link">
              Watch bid preparation ↗
            </Link>
          </article>
          <article className="bco-card">
            <ProductIcon kind="clock" />
            <h3>Activity and contract work</h3>
            <p>
              Trace actions and keep contract milestones, issues, and follow-up
              work organized as the relationship continues.
            </p>
            <Link href="/demo" className="bco-text-link">
              Explore the product ↗
            </Link>
          </article>
        </div>
      </section>
      <TrialCTA />
    </MarketingShell>
  );
}
