import Link from "next/link";
import { GUIDES_PUBLISHED_ON, GUIDES_UPDATED_ON, contractorGuide, longDate } from "@/lib/marketing/resources";
import { breadcrumbSchema, jsonLdGraph, jsonLdString, organizationRef, organizationSchema, siteImage, siteUrl } from "@/lib/marketing/schema";
import { MarketingShell, TrialCTA } from "./site-shell";

export function ContractorGuidePage({ slug }: { slug: string }) {
  const guide = contractorGuide(slug);
  const site = siteUrl();
  const url = `${site}/resources/${slug}`;
  const schema = jsonLdGraph([
    organizationSchema(site),
    {
      "@type": "Article",
      "@id": `${url}#article`,
      headline: guide.title,
      description: guide.description,
      url,
      mainEntityOfPage: url,
      inLanguage: "en-US",
      isAccessibleForFree: true,
      datePublished: GUIDES_PUBLISHED_ON,
      dateModified: GUIDES_UPDATED_ON,
      image: siteImage(site),
      author: organizationRef(site),
      publisher: organizationRef(site),
      about: guide.category === "Idaho contracting" ? "Idaho government contracting" : "Government bid preparation",
    },
    breadcrumbSchema([
      { name: "Home", path: "/" },
      { name: "Resources", path: "/resources" },
      { name: guide.title, path: `/resources/${slug}` },
    ], site),
  ]);
  return <MarketingShell>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(schema) }} />
    <article className="bco-container bco-guide">
      <nav className="bco-breadcrumb" aria-label="Breadcrumb"><Link href="/">Home</Link><span aria-hidden="true">/</span><Link href="/resources">Resources</Link><span aria-hidden="true">/</span><span aria-current="page">{guide.category}</span></nav>
      <p className="bco-kicker">{guide.category}</p>
      <h1>{guide.title}</h1>
      <p className="bco-lead">{guide.intro}</p>
      <p className="bco-caption">By BrostCo · Published {longDate(GUIDES_PUBLISHED_ON)} · Source links checked {longDate(GUIDES_UPDATED_ON)}. Verify current instructions with the buying agency.</p>
      <nav className="bco-guide-toc" aria-label="In this guide"><h2>In this guide</h2><ol>{guide.sections.map((section, i) => <li key={section.heading}><a href={`#section-${i + 1}`}>{section.heading}</a></li>)}</ol></nav>
      {guide.sections.map((section, i) => <section key={section.heading} id={`section-${i + 1}`}>
        <h2>{section.heading}</h2>
        {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        {section.checklist && <ul>{section.checklist.map((item) => <li key={item}>{item}</li>)}</ul>}
      </section>)}
      <aside className="bco-guide-note"><h2>Official sources and further help</h2><ul>{guide.sources.map((source) => <li key={source.href}><a href={source.href} rel="noopener noreferrer">{source.label}</a></li>)}</ul><p>These are independent resources, not endorsements of BrostCo. This guide is a workflow aid, not legal advice or an assurance of bid eligibility.</p></aside>
      <section><h2>Put the next step in one place</h2><p>BrostCo helps organize supported opportunity analysis, subcontractor coordination and draft bid work. Your team verifies source requirements and submits the response. Local notice imports require your own amendment checks.</p><Link className="bco-text-link" href={guide.productHref}>{guide.productLabel} ↗</Link></section>
      <section><h2>A worksheet for your next step</h2><p>Turn this guidance into a document your team can use. The free tools run in your browser and require no account.</p><Link className="bco-text-link" href={slug === "proposal-compliance-matrix" ? "/tools/compliance-matrix" : slug === "government-bid-no-bid-checklist" ? "/tools/bid-no-bid" : "/tools"}>Open the free worksheet ↗</Link></section>
      <nav aria-label="Related guides"><h2>Related guides</h2><ul>{guide.related.map((related) => <li key={related}><Link href={`/resources/${related}`}>{contractorGuide(related).title}</Link></li>)}</ul></nav>
    </article>
    <TrialCTA title="Review your next opportunity with a clearer plan." />
  </MarketingShell>;
}
