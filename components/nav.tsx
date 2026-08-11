"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Wordmark } from "./wordmark";
import { SearchButton } from "./command-palette";

/**
 * Navigation is deliberately lopsided. Only three destinations are real daily
 * work; everything else is reference you visit on purpose, or something the
 * platform already surfaces on Today when it needs you. Showing all fourteen
 * at equal weight implied fourteen responsibilities. Nothing was removed,
 * secondary pages simply live behind "More" (which carries a dot when
 * anything inside it needs attention, so nothing can hide).
 *
 * On phones the menu is a slide-over drawer (not a push-down block) so the
 * page underneath stays put and the thumb reaches every destination.
 */

interface Item {
  href: string;
  label: string;
  hint?: string;
  badge?: "review" | "calls";
}

const PRIMARY: Item[] = [
  { href: "/today", label: "Today", hint: "Everything that needs you" },
  { href: "/call-queue", label: "Call Queue", hint: "Work calls one after another", badge: "calls" },
  { href: "/pipeline", label: "Pipeline", hint: "Every record, by whose turn it is" },
  { href: "/review", label: "Review", hint: "Borderline opportunities to pursue or pass", badge: "review" },
];

const MORE: { section: string; items: Item[] }[] = [
  {
    section: "Records",
    items: [
      { href: "/subs", label: "Subcontractors" },
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Renewals & compliance" },
    ],
  },
  {
    section: "Check on the system",
    items: [
      { href: "/agents", label: "What the system did" },
      { href: "/email-log", label: "Email log" },
      { href: "/analytics", label: "Results & numbers" },
      { href: "/authority", label: "Site authority" },
      { href: "/how-it-works", label: "How this all works" },
    ],
  },
  {
    section: "Settings",
    items: [
      { href: "/settings/profile", label: "Company profile" },
      { href: "/settings/billing", label: "Billing" },
      { href: "/settings/rules", label: "Automation rules" },
      { href: "/settings/content", label: "Content library" },
      { href: "/settings/integrations", label: "Connected services" },
    ],
  },
];

function padIndex(n: number) {
  return String(n).padStart(2, "0");
}

export function Nav({
  email,
  reviewCount,
  callCount,
  engineHealthy,
  engineLabel,
  automationPaused = false,
}: {
  email: string;
  reviewCount: number;
  callCount: number;
  /** Whether the background automation has run recently. */
  engineHealthy?: boolean;
  /** e.g. "last activity 2m ago" */
  engineLabel?: string;
  /** Master kill switch is on; nothing automated will run. */
  automationPaused?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const counts = { review: reviewCount, calls: callCount };

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreHasActive = MORE.some((g) => g.items.some((i) => isActive(i.href)));
  const moreNeedsAttention = reviewCount > 0;
  const initials = email
    .split("@")[0]
    .split(/[.\-_]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2) || "BC";

  function Row({
    item,
    index,
    compact = false,
  }: {
    item: Item;
    index?: number;
    compact?: boolean;
  }) {
    const active = isActive(item.href);
    const badge = item.badge ? counts[item.badge] : 0;
    return (
      <Link
        href={item.href}
        onClick={() => setOpen(false)}
        className={`flex min-h-11 items-center justify-between gap-2 rounded-md pr-2 transition-colors md:min-h-0 ${
          compact ? "py-2.5 pl-3 text-sm md:py-1.5" : "py-2.5 pl-3 md:py-2"
        } ${
          active
            ? "bg-gold/15 font-medium text-gold"
            : "text-white/60 hover:bg-white/5 hover:text-white"
        }`}
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
          {index != null && (
            <span
              className={`num shrink-0 text-[0.65rem] tracking-wider ${
                active ? "text-gold" : "text-white/30"
              }`}
            >
              {padIndex(index)}
            </span>
          )}
          <span className="min-w-0">
            <span className={compact ? "" : "block text-sm"}>{item.label}</span>
            {!compact && item.hint && (
              <span className="mt-0.5 block text-xs font-normal text-white/35">
                {item.hint}
              </span>
            )}
          </span>
        </span>
        {badge > 0 && (
          <span className="badge shrink-0 rounded-full bg-gold px-1.5 text-ink">
            {badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <>
      {/* Mobile top bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-ink px-4 py-3 md:hidden">
        <Link href="/today" className="inline-flex items-center" aria-label="Brost Co Today">
          <Wordmark variant="light" className="h-5" />
        </Link>
        <button
          type="button"
          className="shell-ghost inline-flex h-11 w-11 items-center justify-center px-0"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? "✕" : "☰"}
        </button>
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[70] bg-black/60 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <nav
        aria-label="Main"
        aria-hidden={isMobile && !open ? true : undefined}
        className={`fixed inset-y-0 left-0 z-[71] flex w-[min(20rem,88vw)] max-w-full flex-col border-r border-white/10 bg-ink transition-transform duration-200 ease-out md:static md:z-auto md:h-full md:w-64 md:transition-none ${
          open
            ? "translate-x-0"
            : "pointer-events-none -translate-x-full md:pointer-events-auto md:translate-x-0"
        }`}
      >
        <div className="hidden shrink-0 px-5 py-6 md:block">
          <Link href="/today" className="block" aria-label="Brost Co Today">
            <Wordmark variant="light" className="h-7" />
            <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-white/35">
              Workspace
            </p>
          </Link>
        </div>

        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 md:hidden">
          <Wordmark variant="light" className="h-5" />
          <button
            type="button"
            className="shell-ghost inline-flex h-11 w-11 items-center justify-center px-0"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div className="shrink-0 space-y-1.5 px-3 pb-2 pt-3 md:px-4 md:pt-0">
          <SearchButton className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 bg-shell px-3 py-2 text-sm text-white/45 transition-colors hover:border-white/25 hover:text-white/80 md:min-h-0 md:py-1.5" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event("open-guide-wizard"));
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-white/15 bg-transparent px-3 py-2 text-sm text-white/55 transition-colors hover:border-gold/40 hover:bg-gold/10 hover:text-gold md:min-h-0 md:py-1.5"
          >
            <span aria-hidden className="text-gold">
              ?
            </span>
            Guide Me
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:overflow-y-auto md:px-4 md:pb-3">
          <p className="mb-2 px-3 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-white/30">
            Workspace
          </p>
          {PRIMARY.map((item, i) => (
            <Row key={item.href} item={item} index={i + 1} />
          ))}

          <div className="pt-3">
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen || moreHasActive}
              className="flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2 text-sm text-white/55 transition-colors hover:text-white md:min-h-0 md:py-1.5"
            >
              <span className="flex items-center gap-2">
                More
                {moreNeedsAttention && !moreOpen && !moreHasActive && (
                  <span
                    aria-label={`${reviewCount} waiting`}
                    className="inline-block h-1.5 w-1.5 rounded-full bg-gold"
                  />
                )}
              </span>
              <span
                aria-hidden
                className={`text-xs text-white/35 transition-transform ${
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
                    <p className="mb-1 px-3 text-[0.6rem] font-medium uppercase tracking-[0.14em] text-white/30">
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

        {engineLabel && (
          <Link
            href="/agents"
            onClick={() => setOpen(false)}
            className={`mx-3 mb-2 shrink-0 rounded-md border px-3 py-3 text-xs transition-colors ${
              automationPaused
                ? "border-review/40 bg-review/10 text-white/85"
                : "border-white/10 bg-shell text-white/65 hover:border-white/20 hover:text-white"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  automationPaused
                    ? "bg-review"
                    : engineHealthy
                      ? "animate-pulse bg-pursue"
                      : "bg-risk"
                }`}
              />
              <span className="min-w-0 truncate">{engineLabel}</span>
            </span>
          </Link>
        )}

        <div className="shrink-0 border-t border-white/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-white/20 text-xs font-medium text-white">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-white/55">{email}</p>
              <button
                onClick={logout}
                className="mt-1 text-xs text-white/40 underline-offset-2 hover:text-white hover:underline"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
}
