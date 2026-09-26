import Link from "next/link";
import { MarketingShell, PageIntro, TrialCTA } from "@/components/marketing/site-shell";
import { CONTRACTOR_GUIDES } from "@/lib/marketing/resources";
import { publicMetadata } from "@/lib/marketing/metadata";

export const metadata = publicMetadata("Government contracting resources and Idaho bid guides", "Official Boise and Idaho bid sources, federal opportunity search guidance, and practical checklists for bid decisions, proposal requirements and subcontractor quotes.", "/resources");

export default function ResourcesPage() {
  return <MarketingShell>
    <PageIntro eyebrow="Contractor resources" title="Find the right work. Prepare a clearer response." copy="Official-source guides for Boise and Idaho contracting, plus practical checklists for federal opportunity review and bid preparation. No email gate." />
    {(["Idaho contracting", "Bid preparation"] as const).map((category) => <section className="bco-container bco-section" key={category}>
      <h2>{category}</h2><div className="bco-card-grid">{CONTRACTOR_GUIDES.filter((guide) => guide.category === category).map((guide) => <article className="bco-card" key={guide.slug}><h3><Link href={`/resources/${guide.slug}`}>{guide.title}</Link></h3><p>{guide.description}</p><Link className="bco-text-link" href={`/resources/${guide.slug}`}>Read the guide ↗</Link></article>)}</div>
    </section>)}
    <TrialCTA />
  </MarketingShell>;
}
