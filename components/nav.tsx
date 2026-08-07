"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Wordmark } from "./wordmark";
import { SearchButton } from "./command-palette";

/**
 * Navigation is deliberately lopsided. Only three destinations are real daily
 * work; everything else is reference you visit on purpose, or something the
 * platform already surfaces on Today when it needs you. Showing all fourteen
 * at equal weight implied fourteen responsibilities. Nothing was removed,
 * secondary pages simply live behind "More" (which carries a dot when
 * anything inside it needs attention, so nothing can hide).
 */

interface Item {
  href: string;
  label: string;
  hint?: string;
  badge?: "review" | "calls";
}

const PRIMARY: Item[] = [
  { href: "/today", label: "Today", hint: "Everything that needs you" },
  { href: "/call-queue", label: "Calls to make", hint: "Work them one after another", badge: "calls" },
  { href: "/pipeline", label: "All opportunities", hint: "Every record, by whose turn it is" },
];

const MORE: { section: string; items: Item[] }[] = [
  {
    section: "Records",
    items: [
      { href: "/review", label: "Decisions waiting", badge: "review" },
      { href: "/subs", label: "Subcontractors" },
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Renewals & compliance" },
    ],
  },
  {
    section: "Check on the system",
    items: [
      { href: "/agents", label: "What the system did" },
      { href: "/analytics", label: "Results & numbers" },
      { href: "/authority", label: "Site authority" },
      { href: "/how-it-works", label: "How this all works" },
    ],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/profile", label: "Company profile" },
      { href: "/settings/rules", label: "Automation rules" },
      { href: "/settings/content", label: "Content library" },
      { href: "/settings/integrations", label: "Connected services" },
    ],
  },
];

export function Nav({
  email,
  reviewCount,
  callCount,
  engineHealthy,
  engineLabel,
}: {
  email: string;
  reviewCount: number;
  callCount: number;
  /** Whether the background automation has run recently. */
  engineHealthy?: boolean;
  /** e.g. "last activity 2m ago" */
  engineLabel?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const counts = { review: reviewCount, calls: callCount };

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreHasActive = MORE.some((g) => g.items.some((i) => isActive(i.href)));
  const moreNeedsAttention = reviewCount > 0;

  function Row({ item, compact = false }: { item: Item; compact?: boolean }) {
    const active = isActive(item.href);
    const badge = item.badge ? counts[item.badge] : 0;
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        className={`flex items-center justify-between gap-2 border-l-2 pr-2 transition-colors ${
          compact ? "py-1.5 pl-3 text-sm" : "py-2 pl-3"
        } ${
          active
            ? "border-accent bg-accent-soft font-medium text-accent-strong"
            : "border-transparent text-slate-600 hover:border-border-strong hover:text-foreground"
        }`}
      >
        <span className="min-w-0">
          <span className={compact ? "" : "block text-sm font-medium"}>{item.label}</span>
          {!compact && item.hint && (
            <span className="mt-0.5 block text-xs font-normal text-slate-500">{item.hint}</span>
          )}
        </span>
        {badge > 0 && <span className="badge shrink-0 bg-accent-soft text-accent">{badge}</span>}
      </Link>
    );
  }

  return (
    <>
      {/* mobile top bar */}
      <div className="flex items-center justify-between border-b border-border bg-background px-4 py-3 md:hidden">
        <Wordmark className="text-xl font-semibold text-foreground" />
        <button className="btn-ghost" onClick={() => setOpen((o) => !o)} aria-label="menu">
          ☰
        </button>
      </div>

      <nav
        className={`${
          open ? "block" : "hidden"
        } w-full shrink-0 border-b border-border bg-background md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:border-b-0 md:border-r`}
      >
        <div className="hidden shrink-0 px-6 py-6 md:block">
          <Wordmark className="text-2xl font-semibold tracking-tight text-foreground" />
          <p className="eyebrow mt-1">Procurement Execution</p>
        </div>

        <div className="shrink-0 px-3 pb-2 md:px-4">
          <SearchButton className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-border-strong hover:text-foreground" />
        </div>

        <div className="scroll-thin flex-1 space-y-1 p-3 md:overflow-y-auto md:px-4">
          {PRIMARY.map((item) => (
            <Row key={item.href} item={item} />
          ))}

          {/* Everything else, one click away. */}
          <div className="pt-2">
            <button
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen || moreHasActive}
              className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:text-foreground"
            >
              <span className="flex items-center gap-2">
                More
                {moreNeedsAttention && !moreOpen && !moreHasActive && (
                  <span
                    aria-label={`${reviewCount} waiting`}
                    className="inline-block h-1.5 w-1.5 rounded-full bg-accent"
                  />
                )}
              </span>
              <span
                aria-hidden
                className={`text-xs text-slate-500 transition-transform ${
                  moreOpen || moreHasActive ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>

            {(moreOpen || moreHasActive) && (
              <div className="mt-1 space-y-3 pb-2">
                {MORE.map((group) => (
                  <div key={group.section}>
                    <p className="eyebrow mb-1 px-3 text-[0.6rem] font-bold text-slate-500">
                      {group.section}
                    </p>
                    <ul className="space-y-0.5">
                      {group.items.map((item) => (
                        <li key={item.href}>
                          <Row item={item} compact />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* One line that answers "is the machine OK?", so the log is never a
            page you have to remember to check. */}
        {engineLabel && (
          <Link
            href="/agents"
            className="shrink-0 border-t border-border px-4 py-2.5 text-xs text-slate-600 transition-colors hover:text-foreground"
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  engineHealthy ? "animate-pulse bg-pursue" : "bg-risk"
                }`}
              />
              <span className="min-w-0 truncate">{engineLabel}</span>
            </span>
          </Link>
        )}

        <div className="shrink-0 border-t border-border p-4">
          <p className="truncate text-xs text-slate-500">{email}</p>
          <button onClick={logout} className="btn-ghost mt-2 w-full text-xs">
            Sign out
          </button>
        </div>
      </nav>
    </>
  );
}
