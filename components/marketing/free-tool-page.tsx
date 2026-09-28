import Link from "next/link";
import { MarketingShell, PageIntro, TrialCTA } from "./site-shell";
import { FREE_TOOLS } from "@/lib/marketing/free-tools";
import "./free-tools.css";
export function FreeToolPage({ slug, children }: { slug: typeof FREE_TOOLS[number]["slug"]; children: React.ReactNode }) {
  const tool = FREE_TOOLS.find(t => t.slug === slug)!;
  const schema = { "@context": "https://schema.org", "@type": "WebApplication", name: tool.title, description: tool.description, applicationCategory: "BusinessApplication", operatingSystem: "Web browser", url: `https://brostco.com/tools/${slug}`, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@type": "Organization", name: "BrostCo" } };
  return <MarketingShell><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} /><PageIntro eyebrow="Free contractor tools" title={tool.title} copy={tool.description} />
    <section className="bco-container bco-tool-section"><p className="bco-tool-privacy">Free to use. No signup. No AI usage charges. Form entries stay in your browser tab.</p>{children}
      <p className="bco-tool-related"><Link href="/tools">All free tools</Link> · <Link href="/resources">Contracting guides</Link> · <Link href="/contract-opportunities">Find official opportunity sources</Link></p>
    </section><TrialCTA title="Keep the whole pursuit organized." /></MarketingShell>;
}
