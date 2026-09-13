import type { Metadata } from "next";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
} from "@/components/marketing/site-shell";
import { WorkflowDemo } from "@/components/marketing/workflow-demo";
import { ProductVideo } from "@/components/marketing/product-video";
export const metadata: Metadata = {
  title: "Explore BrostCo | Interactive tour and product videos",
  description:
    "Try an ungated sample workflow and watch the BrostCo workspace in action, with captions and transcripts. No account required.",
  alternates: { canonical: "/demo" },
};
const recordings = [
  [
    "pipeline",
    "Review the opportunity pipeline",
    "See fit, deadlines, and the next action before opening an opportunity.",
  ],
  [
    "subs",
    "Work with subcontractors",
    "Explore the roster, contact details, and the context behind the next conversation.",
  ],
  [
    "opportunity",
    "Prepare a bid for review",
    "Keep source materials, pricing, requirements, and missing information together.",
  ],
  [
    "activity",
    "Trace the work",
    "Inspect recorded actions and their details when you need to know what happened.",
  ],
];
export default function DemoPage() {
  return (
    <MarketingShell>
      <PageIntro
        eyebrow="Product tour"
        title="See the work. Try the next step."
        copy="Explore a sample pursuit at your own pace, then watch recordings of the actual BrostCo workspace. No account or email required."
      />
      <section className="bco-container bco-section">
        <WorkflowDemo />
      </section>
      <section id="recordings" className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Actual workspace / Sample data"
            title="Two minutes inside BrostCo."
          >
            See how Today, opportunity review, subcontractors, and bid
            preparation connect. These recordings use sample records and may
            show a slightly earlier workspace layout.
          </SectionHeading>
          <div className="bco-main-video">
            <ProductVideo
              slug="platform-walkthrough"
              poster="/demos/pipeline-desktop.jpg"
              title="Two-minute BrostCo platform walkthrough using sample data"
            />
            <p className="bco-caption">
              2-minute product walkthrough · English captions ·{" "}
              <a href="/demos/platform-walkthrough.txt">Read the transcript</a>{" "}
              · <a href="/demos/platform-walkthrough.mp4">Open video</a>
            </p>
          </div>
        </div>
      </section>
      <section className="bco-container bco-section">
        <SectionHeading
          eyebrow="Take a closer look"
          title="Explore the work that matters to you."
        />
        <div className="bco-video-grid">
          {recordings.map(([slug, title, copy]) => (
            <article key={slug}>
              <ProductVideo
                slug={slug}
                poster={`/demos/${slug}-desktop.jpg`}
                title={`${title}, product recording with sample data`}
              />
              <div>
                <h3>{title}</h3>
                <p>{copy}</p>
                <a href={`/demos/${slug}.txt`} className="bco-text-link">
                  Read transcript ↗
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <TrialCTA />
    </MarketingShell>
  );
}
