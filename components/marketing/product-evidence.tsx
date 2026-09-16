import Link from "next/link";
import { ProductIcon } from "./site-shell";
import { ProductVideo } from "./product-video";
import { StickyColumn } from "./sticky-column";

/** Product evidence, not invented customer endorsements or outcome metrics. */
export function ProductEvidence({ signupHref }: { signupHref: string }) {
  return (
    <section id="proof" className="bco-product-evidence bco-dark-section" aria-labelledby="bco-evidence-title">
      <div className="bco-container bco-section">
        <div id="walkthrough" className="bco-evidence-intro">
          <StickyColumn>
            <p className="bco-kicker">See the product. Check the work.</p>
            <h2 id="bco-evidence-title">See the whole workflow.</h2>
            <p className="bco-evidence-copy">
              From finding a match to reviewing the bid, follow the work
              through BrostCo in two minutes and fifteen seconds.
            </p>
            <Link href="/demo" className="bco-text-link">Explore the full product tour ↗</Link>
          </StickyColumn>
          <figure className="bco-evidence-film">
            <div className="bco-evidence-film-label"><span>Inside BrostCo</span><span>2 min 15 sec · Narrated tour</span></div>
            <ProductVideo slug="platform-walkthrough" poster="/demos/platform-walkthrough-desktop.jpg" title="BrostCo recorded product tour with sample records" />
            <figcaption>
              Recorded navigation in the redesigned workspace with sample records.
              Staged AI outputs and message history. No external sends.
              {" "}<a href="/demos/platform-walkthrough.txt">Read transcript</a>
            </figcaption>
          </figure>
        </div>
        <div className="bco-evidence-grid">
          <article>
            <ProductIcon kind="source" />
            <h3>See the source</h3>
            <p>Open the original documents beside the AI-prepared brief.</p>
            <Link href="/ai" className="bco-text-link">How AI prepares the work ↗</Link>
          </article>
          <article>
            <ProductIcon kind="clock" />
            <h3>Follow the history</h3>
            <p>Trace messages, replies, quotes, and the actions that need you.</p>
            <Link href="/demo#recordings" className="bco-text-link">Explore activity and conversations ↗</Link>
          </article>
          <article>
            <ProductIcon kind="shield" />
            <h3>Keep the final say</h3>
            <p>You set the rules, confirm pricing and terms, sign, and submit.</p>
            <Link href="/security" className="bco-text-link">Security and data practices ↗</Link>
          </article>
        </div>
        <div className="bco-evidence-next">
          <p>See how it fits your business, with your own opportunities.</p>
          <Link href={signupHref} className="bco-button">Start free trial <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </section>
  );
}
