import { ProductVideo } from "./product-video";

const tours = {
  pipeline: {
    label: "Find opportunities",
    title: "Find the work worth your time.",
    copy: "See fit, deadlines, and next steps in the pipeline. Open a pursuit for the details behind the match.",
  },
  review: {
    label: "Understand the requirements",
    title: "Know what the opportunity asks of you.",
    copy: "Move from the overview into the requirements. Keep the brief and supporting documents with the work you’re reviewing.",
  },
  subs: {
    label: "Coordinate subcontractors",
    title: "Keep your team connected to the work.",
    copy: "Open a subcontractor’s record, related opportunities, and quotes. Outreach is optional if your own team performs the work.",
  },
  communications: {
    label: "Follow conversations",
    title: "Find the reply without losing the thread.",
    copy: "Read the latest message, expand the earlier conversation, and return to what needs your attention.",
  },
  opportunity: {
    label: "Prepare the bid",
    title: "Review the numbers before you commit.",
    copy: "Inspect quote coverage and pricing inside the pursuit. Your team confirms the amounts, terms, and final submission.",
  },
  activity: {
    label: "Track the work",
    title: "See what happened. Open the details.",
    copy: "Follow recorded actions and filter the history. Check the event behind an update when you need more context.",
  },
} as const;

export function HomepageFeatureVideo({ slug }: { slug: keyof typeof tours }) {
  const tour = tours[slug];
  return (
    <article className="bco-feature-video-card" id={`tour-${slug}`} data-feature-video={slug}
      aria-labelledby={`tour-${slug}-title`}>
      <div className="bco-feature-video-copy">
        <p className="bco-kicker">{tour.label}</p>
        <h3 id={`tour-${slug}-title`}>{tour.title}</h3>
        <p>{tour.copy}</p>
      </div>
      <figure>
        <div className="bco-feature-video-media">
          <ProductVideo slug={slug} poster={`/demos/${slug}-desktop.jpg`}
            title={`${tour.label}: 20-second BrostCo walkthrough with sample records`} />
        </div>
        <figcaption>
          <span>20 seconds · Sample records</span>
          <a href={`/demos/${slug}.txt`}>Read transcript <span aria-hidden="true">↗</span></a>
        </figcaption>
      </figure>
    </article>
  );
}

export function HomepageQuickPreview() {
  return (
    <details className="bco-quick-preview" id="quick-preview">
      <summary><span aria-hidden="true">▷</span> Watch the 16-second preview <span aria-hidden="true">+</span></summary>
      <figure>
        <ProductVideo slug="hero-preview" poster="/demos/hero-preview-desktop.jpg"
          title="BrostCo in 16 seconds: silent preview with sample records" />
        <figcaption>
          A quick look at the pipeline and a connected pursuit. Silent, with sample records.{" "}
          <a href="/demos/hero-preview.txt">Read transcript ↗</a>
        </figcaption>
      </figure>
    </details>
  );
}
