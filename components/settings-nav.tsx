"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

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
  // Yours, not the company's: name, role, password, signed-in devices.
  { href: "/settings/account", label: "Your account", match: "/settings/account" },
] as const;

/**
 * Cross-page settings section nav. Lives as static chrome above each settings
 * page (page-shell does not scroll), so in-page EditorialTabs can use
 * layout="fill" without a second sticky offset fighting this bar.
 *
 * On a phone an eight-tab strip is a sideways hunt. A full-width picker is
 * the same destinations, in the shape a thumb can actually use. The strip
 * stays once the sidebar is on screen.
 */
export function SettingsNav() {
  const pathname = usePathname();
  const router = useRouter();
  const current =
    TABS.find((t) => pathname === t.match || pathname.startsWith(t.match + "/")) ?? TABS[0];

  return (
    <>
      <div className="border-b border-border bg-surface px-4 py-2 lg:hidden">
        <label htmlFor="settings-section" className="sr-only">
          Settings section
        </label>
        <select
          id="settings-section"
          className="input w-full"
          value={current.href}
          onChange={(e) => router.push(e.target.value)}
        >
          {TABS.map((t) => (
            <option key={t.href} value={t.href}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
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
