"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CallsIcon,
  MoreIcon,
  OpportunitiesIcon,
  SubsIcon,
  TodayIcon,
} from "@/components/tab-icons";

/**
 * Fixed bottom tabs on phones. Hidden on md+ where the sidebar rules.
 *
 * The five the brief names: Today, Opportunities, Subs, Calls, More.
 *
 * An earlier version gave the fourth slot to Inbox instead of Calls, on the
 * argument that a subcontractor who has written and had no answer is waiting
 * on a person right now while a call is something to go and do. That argument
 * is a good one and it is not this decision to make: the brief names the five.
 *
 * What it does not cost is the signal, because the More tab carries an
 * attention indicator whenever a destination behind it needs action, and
 * Communications is one of those destinations. So an unanswered reply still
 * lights up the bar; it lights up More rather than a tab of its own.
 *
 * Every icon is drawn rather than typed. The old bar used `☰` for
 * Subcontractors, which is the hamburger character the brief rules out, and
 * the rest were glyphs that render differently or not at all depending on the
 * device's font stack.
 */
const TABS: {
  href: string;
  label: string;
  Icon: () => JSX.Element;
  countKey?: "queue" | "calls" | "attention";
}[] = [
  { href: "/today", label: "Today", Icon: TodayIcon, countKey: "queue" },
  { href: "/pipeline", label: "Opportunities", Icon: OpportunitiesIcon },
  { href: "/subs", label: "Subcontractors", Icon: SubsIcon },
  { href: "/call-queue", label: "Calls", Icon: CallsIcon, countKey: "calls" },
  { href: "/more", label: "More", Icon: MoreIcon, countKey: "attention" },
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
  todayCount,
}: {
  reviewCount: number;
  callCount: number;
  /** Conversations waiting on a reply. Same ledger the Communications page uses. */
  inboxCount?: number;
  /**
   * Work still waiting on a person. Defaults to review + calls when the
   * caller has not counted the rest of the ledger.
   */
  todayCount?: number;
}) {
  const pathname = usePathname();
  const counts = {
    // Today's badge is the queue total: everything pending, not one slice.
    queue: todayCount ?? reviewCount + callCount,
    calls: callCount,
    /*
     * More carries whatever is waiting behind it.
     *
     * Today, Opportunities, Subs and Calls each have a tab, so anything needing
     * attention there is already visible. Communications does not, so its
     * count is what this badge is for: without it, moving Inbox off the bar
     * would have hidden the one queue where somebody else is waiting.
     */
    attention: inboxCount,
  };

  return (
    <nav
      aria-label="Quick navigation"
      className="fixed inset-x-0 bottom-0 z-[60] flex border-t border-border/55 bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-white/10 lg:hidden"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
        const count = tab.countKey ? counts[tab.countKey] : 0;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2.5 text-[11px] ${
              active ? "font-semibold text-gold-text" : "text-muted-foreground"
            }`}
          >
            <tab.Icon />
            {/*
              The full word is the accessible name, which is what the audit
              asks for; the visible label is shortened only where five slots on
              a 390px screen genuinely cannot hold it.
            */}
            <span aria-hidden>{SHORT_LABEL[tab.href] ?? tab.label}</span>
            <span className="sr-only">{tab.label}</span>
            {count > 0 && (
              <span
                className="absolute right-[18%] top-1.5 min-w-[1.15rem] rounded-full bg-gold px-1 text-center text-[10px] font-semibold leading-4 text-ink"
                aria-label={`${count} waiting`}
              >
                {count > 99 ? "99+" : count}
              </span>
            )}
            {/*
              The active marker is a bar as well as a colour. State by colour
              alone is what the accessibility rules rule out, and the bold
              weight on the label is the third signal.
            */}
            {active && <span aria-hidden className="absolute inset-x-6 top-0 h-0.5 bg-gold" />}
          </Link>
        );
      })}
    </nav>
  );
}
