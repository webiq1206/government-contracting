import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

interface MarketingFooterProps {
  loginHref?: string;
  variant?: "light" | "dark";
}

export function MarketingFooter({
  loginHref = "/login",
  variant = "dark",
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
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 lg:grid-cols-4">
          <div className="col-span-2 lg:col-span-1">
            <Link
              href="/"
              className="inline-flex items-center coarse:min-h-11"
              aria-label="Brost Co home"
            >
              <Wordmark variant={dark ? "light" : "dark"} className="h-7" />
            </Link>
            <p
              className={`mt-3 max-w-xs text-sm leading-relaxed ${
                dark ? "text-[#C7D2D4]" : "text-muted-foreground"
              }`}
            >
              Procurement execution for federal services contractors. One queue,
              clear next steps, honest limits.
            </p>
          </div>

          <FooterCol title="Product" dark={dark}>
            <Link href="/#platform" className="inline-flex coarse:min-h-11 items-center">Platform</Link>
            <Link href="/#workflow" className="inline-flex coarse:min-h-11 items-center">How it works</Link>
            <Link href="/#pricing" className="inline-flex coarse:min-h-11 items-center">Pricing</Link>
            <Link href="/#faq" className="inline-flex coarse:min-h-11 items-center">FAQ</Link>
          </FooterCol>

          <FooterCol title="Company" dark={dark}>
            <a href="mailto:hello@brostco.com" className="inline-flex coarse:min-h-11 items-center">Contact</a>
            <Link href="/privacy" className="inline-flex coarse:min-h-11 items-center">Privacy</Link>
            <Link href="/terms" className="inline-flex coarse:min-h-11 items-center">Terms</Link>
            {/*
              * The site map, linked from every marketing page.
              *
              * A site map nothing links to is an orphan, which is the one
              * thing it cannot afford to be: a crawler reaches it only if it
              * is reachable, and the footer is where a person looks for it.
              */}
            <Link href="/sitemap" className="inline-flex coarse:min-h-11 items-center">Site map</Link>
          </FooterCol>

          <FooterCol title="Account" dark={dark}>
            <Link href={loginHref} className="inline-flex coarse:min-h-11 items-center">Login</Link>
            <Link href="/signup" className="inline-flex coarse:min-h-11 items-center">Get started</Link>
          </FooterCol>
        </div>

        <div className={`mt-10 h-px ${dark ? "bg-white/10" : "bg-border"}`} />

        <p className={`mt-6 text-xs ${dark ? "text-[#9FB0B4]" : "text-muted-foreground"}`}>
          &copy; {year} Brost Co. Brost Co does not replace SAM.gov. Your team is responsible for final bid review and submission.
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
      <p className={`text-xs font-semibold uppercase tracking-[0.14em] ${dark ? "text-[#6BAEAA]" : "text-accent"}`}>
        {title}
      </p>
      {/*
        * Thumb-sized on a phone, where these were 20px tall in a gapped
        * column, and unchanged above it, where a pointer is precise. The gap
        * collapses on mobile so the column does not grow by the difference.
        */}
      <nav
        className={`mt-3 flex flex-col gap-0 text-sm sm:gap-2 [&_a]:flex coarse:[&_a]:min-h-11 [&_a]:items-center ${
          dark ? "text-[#C7D2D4] [&_a:hover]:text-white" : "text-muted-foreground [&_a:hover]:text-foreground"
        }`}
        aria-label={title}
      >
        {children}
      </nav>
    </div>
  );
}
