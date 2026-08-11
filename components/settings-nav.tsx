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
 * Cross-page settings navigation. Same editorial tab chrome as Opportunity.
 */
export function SettingsNav() {
  const pathname = usePathname();

  return (
    <div
      role="navigation"
      aria-label="Settings sections"
      className="sticky top-0 z-30 flex gap-5 overflow-x-auto border-b border-border bg-background/95 px-4 py-3 backdrop-blur sm:px-6"
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
                ? "dash-tab dash-tab--active whitespace-nowrap uppercase tracking-[0.12em]"
                : "dash-tab whitespace-nowrap uppercase tracking-[0.12em]"
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
