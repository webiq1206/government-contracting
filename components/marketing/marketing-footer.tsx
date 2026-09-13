import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

export function MarketingFooter({
  loginHref = "/login",
}: {
  loginHref?: string;
  variant?: "light" | "dark";
}) {
  const columns = [
    {
      title: "Platform",
      links: [
        ["/platform", "Platform overview"],
        ["/subcontractors", "Subcontractor coordination"],
        ["/ai", "How AI works"],
        ["/demo", "Product tour"],
      ],
    },
    {
      title: "Explore",
      links: [
        ["/pricing-guide", "Pricing & usage"],
        ["/compare", "Compare approaches"],
        ["/get-started", "Getting started"],
        ["/#faq", "Common questions"],
      ],
    },
    {
      title: "Company",
      links: [
        ["/about", "About BrostCo"],
        ["/security", "Security & data"],
        ["/privacy", "Privacy"],
        ["/terms", "Terms"],
        ["/sitemap", "Site map"],
      ],
    },
  ];
  return (
    <footer className="bco-footer">
      <div className="bco-container">
        <div className="bco-footer-grid">
          <div>
            <Link href="/" aria-label="BrostCo home">
              <Wordmark variant="light" className="h-7 w-auto" />
            </Link>
            <p>
              AI for federal services contractors.
              <br />
              From the right opportunity to a bid ready for your review.
            </p>
            <a href="mailto:hello@brostco.com">hello@brostco.com</a>
          </div>
          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2>{column.title}</h2>
              {column.links.map(([href, label]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="bco-footer-bottom">
          <p>
            © {new Date().getFullYear()} BROSTCO HOLDINGS LLC. Your team handles
            final bid review and submission.
          </p>
          <Link href={loginHref}>Log in</Link>
          <Link href="/signup">Start free trial</Link>
        </div>
      </div>
    </footer>
  );
}
