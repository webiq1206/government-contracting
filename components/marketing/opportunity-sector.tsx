import Link from "next/link";
import { MarketingShell, PageIntro, TrialCTA } from "./site-shell";
import { OPPORTUNITY_SECTORS } from "@/lib/marketing/opportunity-sectors";
export function OpportunitySector({ slug }: { slug: string }) {
  const sector = OPPORTUNITY_SECTORS.find(s => s.slug === slug)!;
  return <MarketingShell><PageIntro eyebrow="Opportunity sources" title={sector.title} copy={sector.description} path={`/contract-opportunities/${slug}`} parent={{ label: "Opportunity sources", href: "/contract-opportunities" }} />
    <section className="bco-container bco-section"><div className="bco-card-grid">
      <article className="bco-card"><h2 style={{ fontSize: 26 }}>Start with the official notice</h2><p>Search SAM.gov for federal notices. Use the current notice, attachments and amendments to verify status and response instructions.</p><a href="https://sam.gov/contracting" className="bco-text-link" rel="noopener noreferrer">Open SAM.gov contracting ↗</a><p>Suggested searches: {sector.terms.join(", ")}. Narrow by the work location and your actual qualifications.</p></article>
      <article className="bco-card"><h2 style={{ fontSize: 26 }}>Check fit before writing</h2><ul>{sector.checks.map(check => <li key={check}>{check}</li>)}</ul></article>
      <article className="bco-card"><h2 style={{ fontSize: 26 }}>Keep the decision practical</h2><p>Use a free worksheet, then bring a promising opportunity into your team&apos;s review process.</p><Link className="bco-text-link" href={`/tools/${sector.tool}`}>Use the free tool ↗</Link><p><Link href={`/resources/${sector.guide}`}>Read the related contracting guide</Link></p></article>
    </div>
    <section className="bco-sector-naics" aria-labelledby={`naics-${slug}`}>
      <h2 id={`naics-${slug}`} style={{ fontSize: 26, marginTop: 40 }}>Common NAICS codes for this work</h2>
      <p>Federal notices carry a NAICS code, and the small business size standard follows that code. These codes appear often on {sector.title.replace("Government ", "government ").replace(" contracts", "")} notices. Use them to build a SAM.gov search, then confirm the code named on each notice.</p>
      <table className="bco-table">
        <thead><tr><th scope="col">NAICS code</th><th scope="col">Title (2022 NAICS)</th></tr></thead>
        <tbody>{sector.naics.map(item => <tr key={item.code}><td><code>{item.code}</code></td><td>{item.title}</td></tr>)}</tbody>
      </table>
      <p><Link href="/resources/sam-gov-opportunity-search">How to build a focused SAM.gov search</Link> · <a href="https://www.census.gov/naics/" className="bco-text-link" rel="noopener noreferrer">Look up a code at the U.S. Census Bureau ↗</a></p>
    </section>
    <p style={{ marginTop: 24 }}>This is a source guide, not a live bid board. BrostCo does not claim that a notice is open without checking its current official source. State and local buyers maintain separate portals.</p>
    <p>Before preparing a response, identify the notice type. An RFI may ask for capabilities or other planning information without seeking an offer. Read the requested format, questions and response deadline in the notice, then decide whether a capability summary or a proposal is appropriate. <a href="https://www.acquisition.gov/far/15.201" className="bco-text-link" rel="noopener noreferrer">Read FAR 15.201(e) on RFIs ↗</a></p>
    <p><Link href="/resources/feed.xml">Follow the free resource feed</Link> · <Link href="/contract-opportunities">All industries</Link></p></section><TrialCTA title="Bring a promising opportunity into focus." /></MarketingShell>;
}
