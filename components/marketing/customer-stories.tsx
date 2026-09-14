import Link from "next/link";
import { TRIAL_DAYS } from "@/lib/billing/catalog";

/** Demonstration copy, never represented as customer testimony.
 * Replace with approved, attributed customer stories when supplied.
 * Keep the disclosure on every example, including when reused elsewhere.
 */
const STORIES = [
  {
    role: "Facilities operations lead",
    quote:
      "The brief is ready. The quote requests are out. I can focus on the calls and final review.",
    context:
      "A maintenance pursuit covering HVAC, electrical, and grounds work.",
    output: "Requirements extracted. Outreach sent. Follow-ups scheduled.",
    href: "/demo",
    cta: "Explore the workflow",
  },
  {
    role: "Construction business owner",
    quote:
      "I want to run the business, without spending every morning sorting contract postings.",
    context:
      "Discovery shaped by services, location, qualifications, and target work.",
    output: "AI matches opportunities and explains the fit.",
    href: "/platform",
    cta: "See opportunity discovery",
  },
  {
    role: "Professional services bid lead",
    quote:
      "Give me a working draft and the source material, so I can spend my time making the bid stronger.",
    context:
      "A pursuit that needs a clear brief, organized inputs, and draft documents.",
    output: "AI extracts requirements and prepares bid work for review.",
    href: "/ai",
    cta: "See how AI prepares the work",
  },
] as const;

export function CustomerStories() {
  return (
    <section
      id="proof"
      className="bco-container bco-section bco-stories"
      aria-labelledby="bco-stories-title"
    >
      <div className="bco-heading-row">
        <div className="bco-section-heading">
          <p className="bco-kicker">A lighter workload, made tangible</p>
          <h2 id="bco-stories-title">More room to run your business.</h2>
          <p>
            See how the workflow can fit different teams. These illustrative
            scenarios explain the product; they are not customer testimonials or
            measured results.
          </p>
        </div>
        <Link href="/demo#recordings" className="bco-text-link">
          Explore the product screens ↗
        </Link>
      </div>
      <div className="bco-story-grid">
        {STORIES.map((story, index) => (
          <article
            key={story.role}
            className={`bco-story-card${index === 0 ? " bco-story-featured" : ""}`}
          >
            <div className="bco-story-top">
              <span className="bco-story-label">Illustrative scenario</span>
              <span aria-hidden="true" className="bco-story-quote-mark">
                “
              </span>
            </div>
            <blockquote>
              <p>“{story.quote}”</p>
            </blockquote>
            <div className="bco-story-person">
              <span className="bco-story-avatar" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div>
                <h3>{story.role}</h3>
                <p>Example perspective, not a customer testimonial</p>
              </div>
            </div>
            <p className="bco-story-context">{story.context}</p>
            <div className="bco-story-result">
              <span aria-hidden="true">✧</span>
              <p>{story.output}</p>
            </div>
            <Link href={story.href} className="bco-text-link">
              {story.cta} ↗
            </Link>
          </article>
        ))}
      </div>
      <div className="bco-proof-links">
        <Link href="/demo#recordings">
          <span aria-hidden="true">▷</span>
          <div>
            <strong>See the software in action</strong>
            <span>Guided product previews. No email gate.</span>
          </div>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/security">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Know how the work is handled</strong>
            <span>Sources, activity history, and human control.</span>
          </div>
          <span aria-hidden="true">↗</span>
        </Link>
        <Link href="/signup">
          <span aria-hidden="true">↗</span>
          <div>
            <strong>Try it with your own business</strong>
            <span>{TRIAL_DAYS} days free. No credit card required.</span>
          </div>
          <span aria-hidden="true">↗</span>
        </Link>
      </div>
    </section>
  );
}
