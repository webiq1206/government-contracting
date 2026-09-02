"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/profile", label: "Company", match: "/settings/profile" },
  { href: "/settings/rules", label: "Rules", match: "/settings/rules" },
  { href: "/settings/content", label: "Content", match: "/settings/content" },
  {
    href: "/settings/integrations",
    label: "Integrations",
    match: "/settings/integrations",
  },
  { href: "/settings/billing", label: "Billing", match: "/settings/billing" },
  { href: "/settings/recap", label: "Daily Recap", match: "/settings/recap" },
  {
    href: "/settings/notifications",
    label: "Notifications",
    match: "/settings/notifications",
  },
  { href: "/settings/account", label: "Your account", match: "/settings/account" },
] as const;

/**
 * Cross-page settings section nav. Lives as static chrome above each settings
 * page (page-shell does not scroll), so in-page EditorialTabs can use
 * layout="fill" without a second sticky offset fighting this bar.
 *
 * On a phone a native select felt like a desktop form squeezed into a column.
 * The same destinations now sit on a thumb rail, matching every other chip
 * row in the product. The underline strip stays once the sidebar is on screen.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [pathname]);

  return (
    <>
      <nav
        aria-label="Settings sections"
        className="chip-row border-b border-border bg-surface px-4 py-2 lg:hidden"
      >
        {TABS.map((t) => {
          const active = pathname === t.match || pathname.startsWith(t.match + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              ref={active ? activeRef : undefined}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-xs font-medium ${
                active
                  ? "border-gold bg-gold/15 text-foreground"
                  : "border-border text-foreground"
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div
        role="navigation"
        aria-label="Settings sections"
        className="hidden shrink-0 gap-3 overflow-x-auto border-b border-border bg-surface px-4 py-1.5 sm:gap-5 sm:px-6 sm:py-2 lg:flex"
        style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}
      >
        {TABS.map((t) => {
          const active = pathname === t.match || pathname.startsWith(t.match + "/");
          return (
            <Link
              key={t.href}
              href={t.href}
              className={
                active
                  ? "dash-tab dash-tab--active whitespace-nowrap text-xs uppercase tracking-[0.12em]"
                  : "dash-tab whitespace-nowrap text-xs uppercase tracking-[0.12em]"
              }
              aria-current={active ? "page" : undefined}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </>
  );
}
