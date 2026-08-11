import Link from "next/link";

interface MarketingFooterProps {
  loginHref?: string;
}

export function MarketingFooter({ loginHref = "/login" }: MarketingFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-display text-lg text-foreground">
              BROST <span className="font-accent">CO</span>
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-muted-foreground">
              Procurement execution for federal services contractors. One queue,
              clear next steps, honest limits.
            </p>
          </div>

          <nav
            className="flex flex-wrap gap-x-8 gap-y-3 text-sm"
            aria-label="Footer"
          >
            <Link
              href="/privacy"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Privacy
            </Link>
            <Link
              href="/terms"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Terms
            </Link>
            <Link
              href={loginHref}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Login
            </Link>
            <a
              href="mailto:hello@brostco.com"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Contact
            </a>
          </nav>
        </div>

        <div className="rule mt-8" />

        <p className="mt-6 text-xs text-muted-foreground">
          &copy; {year} Brost Co. Brost Co does not replace SAM.gov and does not
          submit bids on your behalf without your review.
        </p>
      </div>
    </footer>
  );
}
