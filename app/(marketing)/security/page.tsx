import type { Metadata } from "next";
import Link from "next/link";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
  ProductIcon,
} from "@/components/marketing/site-shell";
export const metadata: Metadata = {
  title: "Security, data, and human control",
  description:
    "Understand BrostCo's organization access, integration credentials, AI data flow, activity history, and responsibility for final bid review.",
  alternates: { canonical: "/security" },
};
export default function SecurityPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Security & data"
        title="Understand how your work is handled."
        copy="Your pursuit contains company details, conversations, and bid documents. Here is how BrostCo organizes access, uses connected services, and keeps human review in the workflow."
      />
      <section className="bco-container bco-section">
        <div className="bco-card-grid">
          <article className="bco-card">
            <ProductIcon kind="shield" />
            <h3>Organization-based access</h3>
            <p>
              Account membership and roles determine access to your
              organization's records and actions. Access checks apply to the
              authenticated workspace.
            </p>
          </article>
          <article className="bco-card">
            <ProductIcon kind="source" />
            <h3>Protected connection keys</h3>
            <p>
              Saved integration credentials are encrypted by the application.
              Your service selections determine whether work uses an eligible
              key of your own or a supported platform connection.
            </p>
          </article>
          <article className="bco-card">
            <ProductIcon kind="clock" />
            <h3>Visible activity</h3>
            <p>
              Review recorded actions, communications, and automation status.
              Inspect the supporting record when something needs attention.
            </p>
          </article>
        </div>
      </section>
      <section className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="AI and connected services"
            title="Where information goes, and why."
          />
          <article className="bco-detail-row">
            <h3>AI analysis and drafting</h3>
            <div>
              <p>
                BrostCo sends relevant company and task context to its
                configured model provider to analyze opportunities and prepare
                work. The platform uses Anthropic Claude for AI tasks.
              </p>
              <p>
                Check your organization's data requirements before uploading
                material or enabling a service. Contact us for provider and
                deployment details needed for your review.
              </p>
            </div>
          </article>
          <article className="bco-detail-row">
            <h3>Payments and communications</h3>
            <div>
              <p>
                Stripe processes subscription and usage payments. BrostCo does
                not store full payment card numbers. Connected email and other
                services process the information required for their part of the
                workflow.
              </p>
              <p>
                Service availability and account configuration determine which
                connections run.
              </p>
            </div>
          </article>
          <article className="bco-detail-row">
            <h3>Your data and account</h3>
            <div>
              <p>
                The privacy policy explains what information is collected, how
                it is used, and retention. For account deletion or data
                questions, contact hello@brostco.com.
              </p>
              <Link href="/privacy" className="bco-text-link">
                Read the privacy policy ↗
              </Link>
            </div>
          </article>
        </div>
      </section>
      <section className="bco-container bco-section bco-split">
        <SectionHeading
          eyebrow="Review remains essential"
          title="A clear boundary around automation."
        >
          BrostCo helps prepare the work. Your team checks original
          requirements, confirms pricing, completes signatures and attestations,
          and submits through the agency's channel.
        </SectionHeading>
        <div className="bco-note">
          <strong>Have specific security requirements?</strong>
          <p>
            Ask us about your intended data and procurement requirements before
            uploading restricted material. This page describes product controls;
            it does not claim a government authorization or independent
            certification.
          </p>
          <a href="mailto:hello@brostco.com" className="bco-text-link">
            Contact us about security ↗
          </a>
          <p>
            <Link href="/ai">See AI responsibilities</Link> ·{" "}
            <Link href="/terms">Read the terms</Link>
          </p>
        </div>
      </section>
      <TrialCTA />
    </MarketingShell>
  );
}
