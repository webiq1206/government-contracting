"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Fixed bottom tabs on phones for the pages an operator lives in. One thumb
 * reach to Today / Pipeline / Calls / Review, with live counts, instead of
 * opening the hamburger for every hop. Hidden on md+ where the sidebar rules.
 */
const TABS: { href: string; label: string; icon: string; countKey?: "review" | "calls" }[] = [
  { href: "/today", label: "Today", icon: "☀︎" },
  { href: "/pipeline", label: "Pipeline", icon: "▤" },
  { href: "/call-queue", label: "Calls", icon: "☏", countKey: "calls" },
  { href: "/review", label: "Review", icon: "✓", countKey: "review" },
];

export function MobileTabBar({
  reviewCount,
  callCount,
}: {
  reviewCount: number;
  callCount: number;
}) {
  const pathname = usePathname();
  const counts = { review: reviewCount, calls: callCount };

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-border bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const count = tab.countKey ? counts[tab.countKey] : 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[11px] ${
              active ? "font-semibold text-accent-strong" : "text-slate-500"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {tab.icon}
            </span>
            {tab.label}
            {count > 0 && (
              <span className="absolute right-[18%] top-1.5 min-w-[1.15rem] rounded-full bg-accent px-1 text-center text-[10px] font-semibold leading-4 text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
            {active && (
              <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 rounded-full bg-accent" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
