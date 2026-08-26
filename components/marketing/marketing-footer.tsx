import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

interface MarketingFooterProps {
  loginHref?: string;
  variant?: "light" | "dark";
}

export function MarketingFooter({
  loginHref = "/login",
  variant = "light",
}: MarketingFooterProps) {
  const year = new Date().getFullYear();
  const dark = variant === "dark";

  return (
    <footer
      className={
        dark
          ? "border-t border-white/10 bg-ink text-white"
          : "border-t border-border bg-surface"
      }
    >
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="inline-flex" aria-label="Brost Co home">
              <Wordmark variant={dark ? "light" : "dark"} className="h-7" />
            </Link>
            <p
              className={`mt-3 max-w-xs text-sm leading-relaxed ${
                dark ? "text-white/55" : "text-muted-foreground"
              }`}
            >
              Procurement execution for federal services contractors. One queue,
              clear next steps, honest limits.
            </p>
          </div>

          <FooterCol title="Product" dark={dark}>
            <a href="/#platform">Platform</a>
            <a href="/#pipeline">Pipeline</a>
            <a href="/#pricing">Pricing</a>
            <a href="/#faq">FAQ</a>
          </FooterCol>

          <FooterCol title="Company" dark={dark}>
            <a href="mailto:hello@brostco.com">Contact</a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </FooterCol>

          <FooterCol title="Account" dark={dark}>
            <Link href={loginHref}>Login</Link>
            <Link href="/signup">Get started</Link>
          </FooterCol>
        </div>

        <div className={`mt-10 h-px ${dark ? "bg-white/10" : "bg-border"}`} />

        <p className={`mt-6 text-xs ${dark ? "text-white/40" : "text-muted-foreground"}`}>
          &copy; {year} Brost Co. Brost Co does not replace SAM.gov and does not
          submit bids on your behalf without your review.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  dark,
  children,
}: {
  title: string;
  dark: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${dark ? "text-gold-text" : "text-accent"}`}>
        {title}
      </p>
      <nav
        className={`mt-3 flex flex-col gap-2 text-sm ${
          dark ? "text-white/65 [&_a:hover]:text-white" : "text-muted-foreground [&_a:hover]:text-foreground"
        }`}
        aria-label={title}
      >
        {children}
      </nav>
    </div>
  );
}
