import Link from "next/link";
import { MarketingShell, PageIntro, TrialCTA } from "./site-shell";
import { FREE_TOOLS } from "@/lib/marketing/free-tools";
import "./free-tools.css";
import { jsonLdGraph, jsonLdString, organizationRef, organizationSchema, siteUrl } from "@/lib/marketing/schema";
export function FreeToolPage({ slug, children }: { slug: typeof FREE_TOOLS[number]["slug"]; children: React.ReactNode }) {
  const tool = FREE_TOOLS.find(t => t.slug === slug)!;
  const site = siteUrl();
  const schema = jsonLdGraph([
    organizationSchema(site),
    { "@type": "WebApplication", name: tool.title, description: tool.description, applicationCategory: "BusinessApplication", operatingSystem: "Web browser", browserRequirements: "Requires JavaScript", url: `${site}/tools/${slug}`, isAccessibleForFree: true, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: organizationRef(site) },
  ]);
  return <MarketingShell><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdString(schema) }} /><PageIntro eyebrow="Free contractor tools" title={tool.title} copy={tool.description} path={`/tools/${slug}`} parent={{ label: "Free tools", href: "/tools" }} />
    <section className="bco-container bco-tool-section"><p className="bco-tool-privacy">Free to use. No signup. No AI usage charges. Form entries stay in your browser tab.</p>{children}
      <p className="bco-tool-related"><Link href="/tools">All free tools</Link> · <Link href="/resources">Contracting guides</Link> · <Link href="/contract-opportunities">Find official opportunity sources</Link></p>
    </section><TrialCTA title="Keep the whole pursuit organized." /></MarketingShell>;
}
