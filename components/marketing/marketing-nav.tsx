import Link from "next/link";
import { Wordmark } from "@/components/wordmark";
import { MarketingMobileMenu } from "./mobile-menu";
import { MARKETING_LINKS } from "./site-content";
import "./site.css";

export function MarketingNav({
  loginHref = "/login",
  signupHref,
  variant = "light",
}: {
  loginHref?: string;
  signupHref: string;
  onLanding?: boolean;
  variant?: "light" | "dark";
}) {
  return (
    <header className={`bco-nav${variant === "dark" ? " bco-nav-dark" : ""}`}>
      <div className="bco-container bco-nav-inner">
        <Link href="/" aria-label="BrostCo home" className="bco-brand-link">
          <Wordmark
            variant={variant === "dark" ? "light" : "dark"}
            priority
            className="h-7 w-auto"
          />
        </Link>
        <nav aria-label="Primary navigation" className="bco-desktop-nav">
          {MARKETING_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="bco-nav-actions">
          <Link href={loginHref} className="bco-login">
            Log in
          </Link>
          <Link href={signupHref} className="bco-button">
            Start free trial
          </Link>
          <div className="bco-mobile-trigger">
            <MarketingMobileMenu
              signupHref={signupHref}
              loginHref={loginHref}
              dark={variant === "dark"}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
