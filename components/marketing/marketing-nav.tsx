import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

const LINKS = [
  { id: "platform", label: "Product" },
  { id: "pipeline", label: "Guide Me" },
  { id: "pricing", label: "Pricing" },
] as const;

interface MarketingNavProps {
  loginHref?: string;
  signupHref: string;
  /** When true, section links use same-page hashes. Otherwise they point to /#section. */
  onLanding?: boolean;
  /** Dark chrome for the redesign landing hero. */
  variant?: "light" | "dark";
}

function sectionHref(id: string, onLanding: boolean) {
  return onLanding ? `#${id}` : `/#${id}`;
}

export function MarketingNav({
  loginHref = "/login",
  signupHref,
  onLanding = false,
  variant = "light",
}: MarketingNavProps) {
  const dark = variant === "dark";

  return (
    <header
      className={`sticky top-0 z-50 backdrop-blur-md ${
        dark
          ? "border-b border-white/10 bg-ink/85"
          : "border-b border-border bg-background/95"
      }`}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:h-16 sm:px-6">
        <Link
          href="/"
          className="inline-flex min-h-11 shrink-0 items-center sm:min-h-0"
          aria-label="Brost Co home"
        >
          <Wordmark
            variant={dark ? "light" : "dark"}
            className="h-6 sm:h-7"
            priority
          />
        </Link>

        <nav
          className="hidden items-center gap-8 lg:flex"
          aria-label="Marketing sections"
        >
          {LINKS.map((link) => (
            <a
              key={link.id}
              href={sectionHref(link.id, onLanding)}
              className={`text-sm transition-colors ${
                dark
                  ? "text-white/65 hover:text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <Link
            href={loginHref}
            className={`hidden text-sm sm:inline-flex ${
              dark
                ? "rounded-md border border-white/20 px-3.5 py-2 text-white hover:bg-white/5"
                : "btn-ghost"
            }`}
          >
            Login
          </Link>
          <Link
            href={signupHref}
            className={`inline-flex min-h-11 items-center justify-center rounded-md px-3.5 py-2 text-sm font-medium transition-colors ${
              dark
                ? "bg-gold text-ink hover:bg-[#d6b986]"
                : "btn-primary"
            }`}
          >
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
