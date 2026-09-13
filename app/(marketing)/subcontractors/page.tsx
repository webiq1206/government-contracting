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
        title="Get the right people behind the bid."
        copy="Finding an opportunity is only the beginning. BrostCo connects the scope, subcontractor search, outreach, replies, and quotes so your team can see which trades are covered and what still needs attention."
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
                Search for subcontractors around the work and location. Keep
                contact details, qualifications, and verification gaps in the
                record.
              </p>
              <span className="bco-card-result">
                A shortlist your team can evaluate
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="source" />
              <h3>Ask with the scope attached</h3>
              <p>
                Prepare quote requests from the solicitation context. Send and
                follow up through your connected mailbox and configured rules.
              </p>
              <span className="bco-card-result">
                Less repeated explanation and follow-up
              </span>
            </article>
            <article className="bco-card">
              <ProductIcon kind="check" />
              <h3>Turn replies into bid inputs</h3>
              <p>
                Track conversations, capture quote details, and surface unclear
                responses or missing information for a person to resolve.
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
