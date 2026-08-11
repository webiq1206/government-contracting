import Link from "next/link";

const LINKS = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#scoring", label: "Scoring" },
  { href: "#sourcing", label: "Sourcing" },
  { href: "#pricing", label: "Pricing" },
  { href: "#faq", label: "FAQ" },
] as const;

interface MarketingNavProps {
  loginHref?: string;
  signupHref: string;
}

export function MarketingNav({ loginHref = "/login", signupHref }: MarketingNavProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="font-display text-lg tracking-wide text-foreground sm:text-xl"
        >
          BROST <span className="font-accent">CO</span>
        </Link>

        <nav
          className="hidden items-center gap-6 lg:flex"
          aria-label="Marketing sections"
        >
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link href={loginHref} className="btn-ghost hidden text-sm sm:inline-flex">
            Login
          </Link>
          <Link href={signupHref} className="btn-primary text-sm">
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}
