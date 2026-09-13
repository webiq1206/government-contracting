import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
  FAQ,
} from "@/components/marketing/site-shell";
import { OpportunityPreview } from "@/components/marketing/workflow-demo";
import { HOME_FAQ } from "@/components/marketing/site-content";
export const metadata: Metadata = {
  title: "How BrostCo uses AI",
  description:
    "See what AI reads, prepares, and coordinates in BrostCo, which actions depend on your rules, and where your team reviews the work.",
  alternates: { canonical: "/ai" },
};
const rows = [
  [
    "Company profile + opportunity",
    "Fit explanation",
    "Scores alignment with your services, qualifications, location, and pursuit rules.",
    "Check fit and decide whether to pursue.",
  ],
  [
    "Solicitation + attachments",
    "Scope and requirement brief",
    "Extracts dates, scope, risk flags, and requirements into working context.",
    "Verify important facts against the source.",
  ],
  [
    "Trade needs + subcontractor context",
    "Outreach and call preparation",
    "Prepares quote requests, follow-up work, and call guidance around the opportunity.",
    "Configure sending rules; handle relationships and unclear replies.",
  ],
  [
    "Replies + quotes + requirements",
    "Draft bid work",
    "Helps organize quote information, draft narratives, and prepare documents.",
    "Confirm pricing, complete required forms, and review the package.",
  ],
];
export default function AIPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="How AI works"
        title="Useful intelligence. Visible work."
        copy="AI is part of the pursuit workflow, from reading a solicitation to preparing bid documents. BrostCo brings its output back to the record, where your team can check the context and take the next step."
      />
      <section className="bco-container bco-section bco-split">
        <div>
          <SectionHeading title="See the finding. Check the source.">
            A recommendation is more useful when you can understand it. Review
            the requirement brief, supporting materials, and next action
            together.
          </SectionHeading>
          <p className="bco-note">
            This example shows how an extracted scope becomes a working brief.
            It is illustrative sample data. AI can miss or misinterpret
            information, so the original solicitation remains the reference for
            your review.
          </p>
        </div>
        <OpportunityPreview stage={1} />
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Inputs → useful outputs"
            title="What the AI actually does."
          />
          {rows.map(([input, output, action, review]) => (
            <article key={output} className="bco-detail-row">
              <div>
                <p className="bco-kicker">{input}</p>
                <h3>{output}</h3>
              </div>
              <div>
                <p>{action}</p>
                <p>
                  <strong>Your part:</strong> {review}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="bco-container bco-section">
        <SectionHeading
          eyebrow="Clear responsibilities"
          title="Automation follows your setup."
        />
        <div className="bco-card-grid">
          <article className="bco-card">
            <p className="bco-kicker">Scheduled work</p>
            <h3>Runs with connected services</h3>
            <p>
              Opportunity monitoring and background jobs depend on available
              connections, account access, and your configured rules. Status and
              blockers remain visible.
            </p>
          </article>
          <article className="bco-card">
            <p className="bco-kicker">Configured actions</p>
            <h3>Outreach uses your rules</h3>
            <p>
              Emails and follow-ups can run through your connected mailbox after
              sender setup. Review automation settings before enabling sends.
            </p>
          </article>
          <article className="bco-card">
            <p className="bco-kicker">Human decisions</p>
            <h3>Your team checks and submits</h3>
            <p>
              Resolve ambiguities, verify subcontractors and pricing, review
              generated documents, and complete signatures, attestations, and
              agency submission.
            </p>
          </article>
        </div>
        <div className="bco-section-links">
          <Link href="/security" className="bco-text-link">
            AI data handling & access ↗
          </Link>
          <Link href="/get-started" className="bco-text-link">
            Connections & setup ↗
          </Link>
        </div>
      </section>
      <section className="bco-container bco-section bco-faq-section">
        <SectionHeading title="Questions about AI and control." />
        <FAQ items={[HOME_FAQ[1], HOME_FAQ[2], HOME_FAQ[5]]} />
      </section>
      <TrialCTA />
    </MarketingShell>
  );
}
