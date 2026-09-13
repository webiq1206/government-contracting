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
export const metadata: Metadata = {
  title: "AI subcontractor coordination for federal bids",
  description:
    "Find subcontractors by trade, prepare outreach, track quotes and replies, and see the gaps before bid review with BrostCo.",
  alternates: { canonical: "/subcontractors" },
};
export default function SubcontractorsPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Subcontractor coordination"
        title="AI handles outreach. You handle the relationships."
        copy="BrostCo finds subcontractors, sends quote requests, follows up, and processes replies under your rules. Your team makes the calls, resolves unclear responses, and confirms pricing."
      />
      <section className="bco-container bco-section">
        <WorkflowDemo initialStage={2} />
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="From scope to coverage"
            title="Keep each conversation tied to the work."
          />
          <div className="bco-card-grid">
            <article className="bco-card">
              <ProductIcon kind="people" />
              <h3>Find candidates by trade</h3>
              <p>
                AI searches your roster and local candidates by trade and
                location, checks contact routes, and flags gaps.
              </p>
              <span className="bco-card-result">
                A shortlist your team can evaluate
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="source" />
              <h3>Ask with the scope attached</h3>
              <p>
                AI prepares and sends quote requests with the scope attached,
                then follows up through your connected mailbox under your rules.
              </p>
              <span className="bco-card-result">
                Less repeated explanation and follow-up
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="check" />
              <h3>Turn replies into bid inputs</h3>
              <p>
                AI processes replies and captures clearly stated prices. Unclear
                responses and missing information come to your team.
              </p>
              <span className="bco-card-result">
                A visible path from reply to bid review
              </span>
            </article>
          </div>
        </div>
      </section>
      <section className="bco-container bco-section bco-split">
        <SectionHeading
          eyebrow="Before and after"
          title="Less inbox reconstruction. More context when you need it."
        />
        <div>
          <article
            className="bco-detail-row"
            style={{ gridTemplateColumns: "1fr", gap: 12 }}
          >
            <h3>With a disconnected process</h3>
            <p>
              A quote is in one thread. The scope is in a folder. The follow-up
              lives in a reminder. Someone has to put the story back together.
            </p>
          </article>
          <article
            className="bco-detail-row"
            style={{ gridTemplateColumns: "1fr", gap: 12 }}
          >
            <h3>With BrostCo</h3>
            <p>
              Open the pursuit to see the trade, subcontractor, conversation,
              quote, and next action. Your team can pick up the work with the
              context attached.
            </p>
          </article>
          <p className="bco-caption">
            Your team still confirms availability, qualifications, coverage, and
            final pricing. A suggested candidate is not a verified award
            recommendation.
          </p>
          <Link href="/demo#recordings" className="bco-text-link">
            Watch the subcontractor workspace ↗
          </Link>
        </div>
      </section>
      <TrialCTA title="Bring your next quote process together." />
    </MarketingShell>
  );
}
