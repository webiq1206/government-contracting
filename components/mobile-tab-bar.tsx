"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Fixed bottom tabs on phones. Hidden on md+ where the sidebar rules.
 *
 * The five the audit names. Today carries the work queue, so its badge is the
 * whole count of pending work rather than one slice of it; Opportunities and
 * Subcontractors are the records an operator reaches for daily.
 *
 * Inbox earns the fourth slot over Calls. Both are real work modes, and the
 * difference is who is waiting: a subcontractor who has written and had no
 * answer is waiting on a person right now, while a call is something to go
 * and do. Calls keeps its badge on Today and its own entry on More, and the
 * work queue is the other door into both.
 *
 * More exists because without it Contracts, Compliance, Analytics, Automation
 * Health, the Knowledge Center, Settings and Platform Admin were reachable on
 * a phone only by opening the navigation drawer, which is the desktop sidebar
 * wearing a different coat.
 */
const TABS: {
  href: string;
  label: string;
  icon: string;
  countKey?: "queue" | "calls" | "inbox";
}[] = [
  { href: "/today", label: "Today", icon: "☀︎", countKey: "queue" },
  { href: "/pipeline", label: "Opportunities", icon: "▤" },
  { href: "/subs", label: "Subcontractors", icon: "☰" },
  { href: "/communications", label: "Inbox", icon: "✉", countKey: "inbox" },
  { href: "/more", label: "More", icon: "⋯" },
];

/** Visible text where the full label will not fit five across. */
const SHORT_LABEL: Record<string, string> = {
  "/pipeline": "Bids",
  "/subs": "Subs",
};

export function MobileTabBar({
  reviewCount,
  callCount,
  inboxCount = 0,
}: {
  reviewCount: number;
  callCount: number;
  /** Conversations waiting on a reply. Same ledger the Communications page uses. */
  inboxCount?: number;
}) {
  const pathname = usePathname();
  // The Today badge is the queue total: everything pending, not one slice.
  const counts = { queue: reviewCount + callCount, calls: callCount, inbox: inboxCount };

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
              active ? "font-semibold text-gold-text" : "text-muted-foreground"
            }`}
          >
            <span aria-hidden className="text-lg leading-none">
              {tab.icon}
            </span>
            {/*
              * The full word is the accessible name, which is what the audit
              * asks for; the visible label is shortened only where five slots
              * on a 390px screen genuinely cannot hold it.
              */}
            <span aria-hidden>{SHORT_LABEL[tab.href] ?? tab.label}</span>
            <span className="sr-only">{tab.label}</span>
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
