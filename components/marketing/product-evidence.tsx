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
            <h2 id="bco-evidence-title">Confidence comes from seeing the work.</h2>
            <p className="bco-evidence-copy">
              Look inside the workspace before you create an account. Follow
              the opportunity, the conversations, and the bid preparation in
              one place.
            </p>
            <Link href="/demo" className="bco-text-link">Explore the full product tour ↗</Link>
          </StickyColumn>
          <figure className="bco-evidence-film">
            <div className="bco-evidence-film-label"><span>Inside BrostCo</span><span>2-minute walkthrough</span></div>
            <ProductVideo slug="platform-walkthrough" poster="/demos/pipeline-desktop.jpg" title="BrostCo guided product preview with sample records" />
            <figcaption>
              Captured product screens with sample records and an earlier workspace layout.
              {" "}<a href="/demos/platform-walkthrough.txt">Read transcript</a>
            </figcaption>
          </figure>
        </div>
        <div className="bco-evidence-grid">
          <article>
            <ProductIcon kind="source" />
            <h3>See the source</h3>
            <p>Check original documents alongside the AI-prepared brief. Important decisions should never depend on a summary alone.</p>
            <Link href="/ai" className="bco-text-link">How AI prepares the work ↗</Link>
          </article>
          <article>
            <ProductIcon kind="clock" />
            <h3>Follow the history</h3>
            <p>Trace sent messages, received replies, quotes, and blocked actions. See what happened and why the next step needs you.</p>
            <Link href="/demo#recordings" className="bco-text-link">Explore activity and conversations ↗</Link>
          </article>
          <article>
            <ProductIcon kind="shield" />
            <h3>Keep the final say</h3>
            <p>Your rules guide automation. Your team confirms pricing, reviews contract terms, signs, and submits.</p>
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
