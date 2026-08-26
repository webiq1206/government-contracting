"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/settings/profile", label: "Profile", match: "/settings/profile" },
  { href: "/settings/rules", label: "Rules", match: "/settings/rules" },
  { href: "/settings/content", label: "Content", match: "/settings/content" },
  {
    href: "/settings/integrations",
    label: "Integrations",
    match: "/settings/integrations",
  },
  { href: "/settings/billing", label: "Billing", match: "/settings/billing" },
  {
    href: "/settings/notifications",
    label: "Notifications",
    match: "/settings/notifications",
  },
] as const;

/**
 * Cross-page settings section nav. Lives as static chrome above each settings
 * page (page-shell does not scroll), so in-page EditorialTabs can use
 * layout="fill" without a second sticky offset fighting this bar.
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div
      role="navigation"
      aria-label="Settings sections"
      className="flex shrink-0 gap-3 overflow-x-auto border-b border-border bg-surface px-4 py-1.5 sm:gap-5 sm:px-6 sm:py-2"
      style={{ WebkitOverflowScrolling: "touch" } as CSSProperties}
    >
      {TABS.map((t) => {
        const active =
          pathname === t.match || pathname.startsWith(t.match + "/");
        return (
          <Link
            key={t.href}
            href={t.href}
            className={
              active
                ? "dash-tab dash-tab--active shrink-0 whitespace-nowrap text-xs uppercase tracking-[0.12em]"
                : "dash-tab shrink-0 whitespace-nowrap text-xs uppercase tracking-[0.12em]"
            }
            aria-current={active ? "page" : undefined}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
