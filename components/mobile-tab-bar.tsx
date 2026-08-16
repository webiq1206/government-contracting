"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Fixed bottom tabs on phones for the pages an operator lives in. Hidden on
 * md+ where the sidebar rules.
 *
 * Re-slotted around the unified work queue: Today carries the queue, so its
 * badge is the whole count of pending work (calls and review decisions
 * included), and the records an operator reaches for daily, opportunities
 * and subcontractors, take the middle slots. Calls keeps a tab because
 * batch-calling is a real work mode, with the queue as the other door in.
 * Review left the bar: decisions surface in the queue and the drawer still
 * links the page, so nothing breaks, it just stops costing a permanent slot
 * for the least-frequent destination.
 */
const TABS: { href: string; label: string; icon: string; countKey?: "queue" | "calls" }[] = [
  { href: "/today", label: "Today", icon: "☀︎", countKey: "queue" },
  { href: "/pipeline", label: "Opportunities", icon: "▤" },
  { href: "/subs", label: "Subs", icon: "☰" },
  { href: "/call-queue", label: "Calls", icon: "☏", countKey: "calls" },
];

export function MobileTabBar({
  reviewCount,
  callCount,
}: {
  reviewCount: number;
  callCount: number;
}) {
  const pathname = usePathname();
  // The Today badge is the queue total: everything pending, not one slice.
  const counts = { queue: reviewCount + callCount, calls: callCount };

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-border/55 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 md:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const count = tab.countKey ? counts[tab.countKey] : 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[11px] ${
              active ? "font-semibold text-gold" : "text-muted-foreground"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {tab.icon}
            </span>
            {tab.label}
            {count > 0 && (
              <span className="absolute right-[18%] top-1.5 min-w-[1.15rem] rounded-full bg-gold px-1 text-center text-[10px] font-semibold leading-4 text-ink">
                {count > 99 ? "99+" : count}
              </span>
            )}
            {active && (
              <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-gold" />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
