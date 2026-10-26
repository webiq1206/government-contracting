/* eslint-disable @next/next/no-img-element */
import type { ReactNode } from "react";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * Split workspace entrance used by login and signup.
 *
 * Left panel is a real construction photograph (tower crane, cast concrete,
 * exposed rebar), cropped and graded for this surface. Source: Unsplash
 * photo-1541888946425-d81bb19240f5, Unsplash License. It carries no seal,
 * award, or project name.
 */
export function AuthSplit({
  kicker,
  headline,
  support,
  footer,
  children,
}: {
  kicker: string;
  headline: ReactNode;
  support: string;
  footer: string;
  children: ReactNode;
}) {
  return (
    <div className="auth-split">
      <aside className="auth-hero" aria-label="BrostCo">
        <div className="auth-hero-media" aria-hidden="true">
          <img
            src="/brand/auth-hero.jpg"
            alt=""
            width={1400}
            height={1800}
            className="auth-hero-photo"
            decoding="async"
            fetchPriority="high"
          />
          <div className="auth-hero-scrim" />
        </div>
        <div className="auth-hero-copy">
          <Link href="/" className="auth-brand">
            {/* White wordmark, always, because this panel stays photographic. */}
            <img
              src="/brand/wordmark-light.png"
              alt="BrostCo"
              width={699}
              height={160}
              className="auth-brand-mark"
              draggable={false}
            />
          </Link>
          <div className="auth-hero-story">
            <p className="auth-hero-kicker">{kicker}</p>
            <p className="auth-hero-title">{headline}</p>
            <p className="auth-hero-support">{support}</p>
            <p className="auth-hero-foot">{footer}</p>
          </div>
        </div>
      </aside>
      <main className="auth-panel">
        <div className="auth-panel-bar">
          <Link href="/" className="auth-back">
            Back to BrostCo
          </Link>
          <ThemeToggle compact />
        </div>
        <div className="auth-panel-body">{children}</div>
      </main>
    </div>
  );
}
