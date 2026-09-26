import { publicMetadata } from "@/lib/marketing/metadata";
import type { Metadata } from "next";
import {
  MarketingShell,
  PageIntro,
  SectionHeading,
  TrialCTA,
} from "@/components/marketing/site-shell";
import { WorkflowDemo } from "@/components/marketing/workflow-demo";
import { ProductVideo } from "@/components/marketing/product-video";
export const metadata: Metadata = publicMetadata(
  "Interactive product tour and walkthroughs",
  "Try an ungated sample workflow and watch the BrostCo workspace in action, with captions and transcripts. No account required.",
  "/demo",
);
const recordings = [
  [
    "review",
    "Check the requirements before you commit",
    "Move between the opportunity overview and its requirements without losing context.",
  ],
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
    "communications",
    "Read the conversation, not the clutter",
    "Open earlier messages and return to the latest reply. Nothing is sent in this tour.",
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
        copy="Explore a sample pursuit, then watch recorded desktop and mobile workflows with guided narration. No account or email required."
      />
      <section className="bco-container bco-section">
        <WorkflowDemo />
      </section>
      <section id="recordings" className="bco-tinted">
        <div className="bco-container bco-section">
          <SectionHeading
            eyebrow="Recorded product workflows / Sample data"
            title="Follow the work inside BrostCo."
          >
            See how opportunity discovery, review, subcontractors, and bid
            preparation connect. These edited tours show real navigation in the
            redesigned application using sample records. AI outputs, quotes, and
            message history are staged examples. No external messages or bids are sent.
          </SectionHeading>
          <div className="bco-main-video">
            <ProductVideo
              slug="platform-walkthrough"
              poster="/demos/pipeline-desktop.jpg"
              title="BrostCo recorded platform tour with narration and sample data"
            />
            <p className="bco-caption">
              Narrated product tour · English captions ·{" "}
              <a href="/demos/platform-walkthrough.txt">Read the transcript</a>{" "}
              · <a href="/demos/platform-walkthrough.mp4">Open video</a>{" "}
              · <a href="/demos/hero-preview.mp4">Quick 16-second preview</a>
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
                title={`${title}, recorded product tour with sample data`}
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
