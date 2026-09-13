import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
} from "@/components/marketing/site-shell";
export const metadata: Metadata = {
  title: "Compare BrostCo with spreadsheets, CRM, alerts, and hiring",
  description:
    "Compare ways to run a federal bid workflow. See where BrostCo fits, when a simpler tool may be enough, and how it complements your team.",
  alternates: { canonical: "/compare" },
};
const approaches = [
  [
    "Spreadsheets + SAM.gov",
    "A flexible, familiar way to track work.",
    "Your team searches, reads, follows up, and assembles the bid.",
    "Occasional bids with a manageable volume of details.",
  ],
  [
    "General CRM",
    "Contact history, stages, reminders, and reporting.",
    "Federal requirements and bid workflows may need configuration or integrations. AI capabilities vary by product.",
    "Teams already organized around a CRM, with capacity to configure their process.",
  ],
  [
    "Bid alerts or search tools",
    "Visibility into published opportunities.",
    "How much analysis and downstream workflow they include varies. Check what happens after an alert.",
    "Teams whose main gap is discovery and who can work the opportunities they find.",
  ],
  [
    "Capture or proposal specialist",
    "Relationships, strategy, judgment, and coordination.",
    "Time still goes into research, document work, and follow-ups. Capacity depends on the role and team.",
    "Organizations needing dedicated expertise and relationship ownership.",
  ],
  [
    "BrostCo",
    "Connected discovery, AI analysis, subcontractor coordination, and bid preparation.",
    "Your team supplies company context, connects services, checks outputs, and submits. Subscription and usage costs apply.",
    "Federal services teams with recurring pursuit work and subcontractor coordination to manage.",
  ],
];
export default function ComparePage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Compare approaches"
        title="Choose around the work that slows you down."
        copy="Different tools solve different parts of government contracting. BrostCo is built for the work between finding an opportunity and having the people, quotes, and documents ready for bid review."
      />
      <section className="bco-container bco-section">
        <div
          className="bco-table-wrap"
          role="region"
          aria-label="Comparison of contracting workflow approaches, horizontally scrollable"
          tabIndex={0}
        >
          <table className="bco-table">
            <caption>
              Typical approaches, not a claim about every product. Tools and
              people can work together. Scroll horizontally on a small screen.
            </caption>
            <thead>
              <tr>
                <th scope="col">Approach</th>
                <th scope="col">What it gives you</th>
                <th scope="col">What to plan for</th>
                <th scope="col">A good fit when</th>
              </tr>
            </thead>
            <tbody>
              {approaches.map(([name, benefit, work, fit]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{benefit}</td>
                  <td>{work}</td>
                  <td>{fit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Where BrostCo earns its place"
            title="The scope. The people. The prepared bid."
          >
            BrostCo connects the details that otherwise travel between an
            opportunity feed, inbox, spreadsheet, and document folder.
          </SectionHeading>
          <div className="bco-card-grid">
            <article className="bco-card">
              <h3>Work after discovery</h3>
              <p>
                Turn a posting into an AI-assisted brief, a subcontractor plan,
                and bid preparation work. Keep the source and reasoning close to
                the action.
              </p>
              <Link href="/platform" className="bco-text-link">
                See the full workflow ↗
              </Link>
            </article>
            <article className="bco-card">
              <h3>Coordination by trade</h3>
              <p>
                Keep subcontractor outreach, replies, calls, and quotes tied to
                the pursuit. See what needs attention before the bid review.
              </p>
              <Link href="/subcontractors" className="bco-text-link">
                Explore subcontractors ↗
              </Link>
            </article>
            <article className="bco-card">
              <h3>A focused daily queue</h3>
              <p>
                Today surfaces decisions, messages, calls, and blockers with
                their context. Activity history helps your team understand what
                happened.
              </p>
              <Link href="/demo" className="bco-text-link">
                Explore the product ↗
              </Link>
            </article>
          </div>
        </div>
      </section>
      <section className="bco-container bco-section bco-split">
        <SectionHeading
          eyebrow="A practical fit check"
          title="Is BrostCo right for your team?"
        />
        <div>
          <ul className="bco-check-list">
            <li>You pursue federal services work regularly.</li>
            <li>Subcontractor sourcing and quote follow-up consume time.</li>
            <li>Your team wants one connected pursuit record.</li>
            <li>
              You have someone responsible for decisions and final review.
            </li>
          </ul>
          <div className="bco-note">
            <strong>A simpler process may be enough</strong>
            <p>
              If you bid rarely or only need alerts, compare the subscription
              and service costs with the time you expect to save. Software also
              complements a capture specialist; it does not replace their
              judgment or relationships.
            </p>
            <Link href="/pricing-guide#value" className="bco-text-link">
              Estimate the value for your workload ↗
            </Link>
          </div>
        </div>
      </section>
      <TrialCTA title="Evaluate it with your next real pursuit." />
    </MarketingShell>
  );
}
