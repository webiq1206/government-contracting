"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ProductVideo } from "./product-video";
import { StickyColumn } from "./sticky-column";

const tours = {
  pipeline: { label: "Find opportunities", short: "Find", copy: "See fit, deadlines, and the next step.", title: "Opportunity discovery", number: "01" },
  review: { label: "Read the requirements", short: "Understand", copy: "Keep the brief and source documents together.", title: "Requirements and documents", number: "02" },
  subs: { label: "Coordinate your team", short: "Your team", copy: "Connect subcontractors, opportunities, and quotes.", title: "Subcontractor coordination", number: "03" },
  communications: { label: "Follow the conversation", short: "Conversations", copy: "Find the latest reply with its full context.", title: "Conversations and replies", number: "04" },
  opportunity: { label: "Review the bid", short: "Bid review", copy: "Check pricing and quote coverage in one place.", title: "Bid preparation and pricing", number: "05" },
  activity: { label: "Trace the work", short: "Activity", copy: "Follow each update back to what happened.", title: "Activity and history", number: "06" },
} as const;

const chapters = {
  discover: {
    number: "01", eyebrow: "Find and understand", title: "Good opportunities. A clear way in.",
    copy: "Find work that fits your business. See why it matches, what it requires, and what needs your attention.",
    slugs: ["pipeline", "review"], href: "/platform", link: "Explore the platform",
  },
  coordinate: {
    number: "02", eyebrow: "Bring the work together", title: "Your team. Every reply. One place.",
    copy: "Keep quotes and conversations with the opportunity. Let AI help with outreach and follow-ups, or do the work with your own team.",
    slugs: ["subs", "communications"], href: "/subcontractors", link: "Explore team coordination",
  },
  prepare: {
    number: "03", eyebrow: "Prepare and review", title: "Less chasing. More ready to review.",
    copy: "Bring requirements, quotes, and pricing into a prepared bid. See what’s missing, check the work, and keep the final say.",
    slugs: ["opportunity", "activity"], href: "/ai", link: "See what AI does and what you control",
  },
} as const;

/** One focused stage per chapter, with both original tours kept on the page. */
export function HomepageFeatureChapter({ chapter }: { chapter: keyof typeof chapters }) {
  const content = chapters[chapter];
  const [selected, setSelected] = useState(0);
  const [horizontal, setHorizontal] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 950px)");
    const update = () => setHorizontal(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function select(index: number, focus = false) {
    // Pause immediately, before React hides the outgoing panel.
    root.current?.querySelectorAll("video").forEach(video => video.pause());
    setSelected(index);
    if (focus) tabs.current[index]?.focus({ preventScroll: true });
  }

  return (
    <div ref={root} className={`bco-feature-chapter bco-feature-chapter-${chapter}`} data-chapter={chapter}>
      <StickyColumn className="bco-chapter-copy">
        <p className="bco-kicker"><span className="bco-chapter-number">{content.number}</span>{content.eyebrow}</p>
        <h2>{content.title}</h2>
        <p className="bco-chapter-description">{content.copy}</p>
        <div role="tablist" className="bco-chapter-tabs" aria-orientation={horizontal ? "horizontal" : "vertical"} aria-label={`${content.eyebrow} product tours`}
          onKeyDown={event => {
            let next = selected;
            if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (selected + 1) % 2;
            else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (selected + 1) % 2;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = 1;
            else return;
            event.preventDefault();
            select(next, true);
          }}>
          {content.slugs.map((slug, index) => (
            <button key={slug} ref={element => { tabs.current[index] = element; }} type="button" role="tab"
              id={`tour-tab-${slug}`} aria-controls={`tour-${slug}`} aria-selected={index === selected}
              tabIndex={index === selected ? 0 : -1} onClick={() => select(index)}>
              <span className="bco-chapter-tab-number" aria-hidden="true">{tours[slug].number}</span>
              <span><strong className="bco-chapter-tab-full">{tours[slug].label}</strong><strong className="bco-chapter-tab-short" aria-hidden="true">{tours[slug].short}</strong><small>{tours[slug].copy}</small></span>
              <span className="bco-chapter-tab-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </div>
        <Link href={content.href} className="bco-text-link bco-chapter-link">{content.link} <span aria-hidden="true">↗</span></Link>
      </StickyColumn>
      <div className="bco-chapter-stage">
        {content.slugs.map((slug, index) => (
          <div key={slug} role="tabpanel" id={`tour-${slug}`} aria-labelledby={`tour-tab-${slug}`}
            hidden={index !== selected} tabIndex={0} data-feature-video={slug} className="bco-feature-video-panel">
            <figure>
              <div className="bco-feature-film-header"><span>{tours[slug].title}</span><span>20 sec tour</span></div>
              <div className="bco-feature-video-media">
                <ProductVideo slug={slug} poster={`/demos/${slug}-desktop.jpg`}
                  title={`${tours[slug].label}: 20-second BrostCo walkthrough with sample records`} />
              </div>
              <figcaption><span>Sample records · Captions included</span><a href={`/demos/${slug}.txt`}>Read transcript <span aria-hidden="true">↗</span></a></figcaption>
            </figure>
          </div>
        ))}
        <noscript><a className="bco-text-link" href="/demo#recordings">View all feature tours ↗</a></noscript>
      </div>
    </div>
  );
}

export function HomepageQuickPreview() {
  return (
    <details className="bco-quick-preview" id="quick-preview">
      <summary><span aria-hidden="true">▷</span> Watch the 16-second preview <span aria-hidden="true">+</span></summary>
      <figure>
        <ProductVideo slug="hero-preview" poster="/demos/hero-preview-desktop.jpg"
          title="BrostCo in 16 seconds: silent preview with sample records" />
        <figcaption>A quick look at the pipeline and a connected pursuit. Silent, with sample records.{" "}<a href="/demos/hero-preview.txt">Read transcript ↗</a></figcaption>
      </figure>
    </details>
  );
}
