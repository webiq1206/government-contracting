import Link from "next/link";
import { MarketingShell, PageIntro, TrialCTA } from "@/components/marketing/site-shell";
import { CONTRACTOR_GUIDES } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

export const metadata = publicMetadata("Government contracting resources and Idaho bid guides", "Official Boise and Idaho bid sources, federal opportunity search guidance, and practical checklists for bid decisions, proposal requirements and subcontractor quotes.", "/resources");

export default function ResourcesPage() {
  return <MarketingShell>
    <PageIntro eyebrow="Contractor resources" title="Find the right work. Prepare a clearer response." copy="Official-source guides for Boise and Idaho contracting, plus practical checklists for federal opportunity review and bid preparation. No email gate." />
    <section className="bco-container bco-section"><h2>Put the guidance to work</h2><div className="bco-card-grid"><article className="bco-card"><h3>Free contractor tools</h3><p>Build a bid decision worksheet, capability statement or compliance matrix. Download your work without signing up.</p><Link className="bco-text-link" href="/tools">Use the free tools ↗</Link></article><article className="bco-card"><h3>Opportunity sources by industry</h3><p>Find official sources and practical checks for construction, cleaning and IT services.</p><Link className="bco-text-link" href="/contract-opportunities">Choose your industry ↗</Link></article><article className="bco-card"><h3>Follow new resources</h3><p>Add our free RSS feed to your reader. No account or email address required.</p><a className="bco-text-link" href="/resources/feed.xml">Open the resource feed ↗</a></article></div></section>
    <section className="bco-container bco-section">
      <h2>Reference</h2>
      <div className="bco-card-grid">
        <article className="bco-card">
          <h3><Link href="/resources/idaho-procurement-sources">Idaho public procurement sources</Link></h3>
          <p>Which Idaho authority advertises which public work, on which official source, and what each source leaves out. Free to cite, and available as JSON and CSV.</p>
          <Link className="bco-text-link" href="/resources/idaho-procurement-sources">Open the register ↗</Link>
        </article>
      </div>
    </section>
    {(["Idaho contracting", "Bid preparation"] as const).map((category) => <section className="bco-container bco-section" key={category}>
      <h2>{category}</h2><div className="bco-card-grid">{CONTRACTOR_GUIDES.filter((guide) => guide.category === category).map((guide) => <article className="bco-card" key={guide.slug}><h3><Link href={`/resources/${guide.slug}`}>{guide.title}</Link></h3><p>{guide.description}</p><Link className="bco-text-link" href={`/resources/${guide.slug}`}>Read the guide ↗</Link></article>)}</div>
    </section>)}
    <TrialCTA />
  </MarketingShell>;
}
