import Link from "next/link";
import { contractorGuide } from "@/lib/marketing/resources";
import { MarketingShell, TrialCTA } from "./site-shell";

export function ContractorGuidePage({ slug }: { slug: string }) {
  const guide = contractorGuide(slug);
  const site = (process.env.APP_URL || "https://brostco.com").replace(/\/$/, "");
  const url = `${site}/resources/${slug}`;
  const schema = [
    { "@context": "https://schema.org", "@type": "Article", headline: guide.title, description: guide.description, mainEntityOfPage: url, author: { "@type": "Organization", name: "BrostCo", url: site }, publisher: { "@type": "Organization", name: "BrostCo", url: site } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: site },
      { "@type": "ListItem", position: 2, name: "Resources", item: `${site}/resources` },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ] },
  ];
  return <MarketingShell>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
    <article className="bco-container bco-guide">
      <nav className="bco-breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/resources">Resources</Link><span aria-hidden="true">/</span><span aria-current="page">{guide.category}</span></nav>
      <p className="bco-kicker">{guide.category}</p>
      <h1>{guide.title}</h1>
      <p className="bco-lead">{guide.intro}</p>
      <p className="bco-caption">By BrostCo · Source links checked September 26, 2026. Verify current instructions with the buying agency.</p>
      <nav className="bco-guide-toc" aria-label="In this guide"><h2>In this guide</h2><ol>{guide.sections.map((section, i) => <li key={section.heading}><a href={`#section-${i + 1}`}>{section.heading}</a></li>)}</ol></nav>
      {guide.sections.map((section, i) => <section key={section.heading} id={`section-${i + 1}`}>
        <h2>{section.heading}</h2>
        {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {section.checklist && <ul>{section.checklist.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>)}
      <aside className="bco-guide-note"><h2>Official sources and further help</h2><ul>{guide.sources.map((source) => <li key={source.href}><a href={source.href} rel="noopener noreferrer">{source.label}</a></li>)}</ul><p>These are independent resources, not endorsements of BrostCo. This guide is a workflow aid, not legal advice or an assurance of bid eligibility.</p></aside>
      <section><h2>Put the next step in one place</h2><p>BrostCo helps organize supported opportunity analysis, subcontractor coordination and draft bid work. Your team verifies source requirements and submits the response. Local notice imports require your own amendment checks.</p><Link className="bco-text-link" href={guide.productHref}>{guide.productLabel} ↗</Link></section>
      <nav aria-label="Related guides"><h2>Related guides</h2><ul>{guide.related.map((related) => <li key={related}><Link href={`/resources/${related}`}>{contractorGuide(related).title}</Link></li>)}</ul></nav>
    </article>
    <TrialCTA title="Review your next opportunity with a clearer plan." />
  </MarketingShell>;
}
