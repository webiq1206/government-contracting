"use client";

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
] as const;

/**
 * Cross-page settings navigation.
 *
 * Mobile: scrolls with the page (non-sticky) so it doesn't eat screen height.
 * Desktop (md+): sticky at top-0, same as before.
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div
      role="navigation"
      aria-label="Settings sections"
      className="flex gap-4 overflow-x-auto border-b border-border bg-background/95 px-4 py-2 backdrop-blur sm:gap-5 sm:px-6 sm:py-3 md:sticky md:top-0 md:z-30"
      style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}
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
                ? "dash-tab dash-tab--active shrink-0 whitespace-nowrap uppercase tracking-[0.12em]"
                : "dash-tab shrink-0 whitespace-nowrap uppercase tracking-[0.12em]"
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
