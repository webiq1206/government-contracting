"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeWordmark } from "./theme-wordmark";
import { ThemeToggle } from "./theme-toggle";
import { SearchButton } from "./command-palette";

/**
 * Navigation is deliberately lopsided. Only three destinations are real daily
 * work; everything else is reference you visit on purpose, or something the
 * platform already surfaces on Today when it needs you. Showing all fourteen
 * at equal weight implied fourteen responsibilities. Nothing was removed,
 * secondary pages simply live behind "More" (which carries a dot when
 * anything inside it needs attention, so nothing can hide).
 *
 * On phones the menu is a full-screen overlay (100vw × 100dvh) so the
 * operator has enough room to read labels and the thumb reaches everywhere.
 * The automation on/off toggle lives here so it's always one tap away.
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
  { href: "/pipeline", label: "Opportunities", hint: "Every opportunity, by whose turn it is" },
  { href: "/review", label: "Review", hint: "Borderline opportunities to pursue or pass", badge: "review" },
];

/**
 * Platform-owner tools, shown only to platform admins.
 *
 * Site Authority tracks OUR marketing domain's backlinks through Ahrefs. It
 * was in the customer navigation, where it is both meaningless to a
 * contractor and a window onto our own business. It is an internal tool and
 * now sits with the other internal tool.
 */
const PLATFORM_ADMIN_ITEMS: Item[] = [
  { href: "/admin/accounts", label: "All accounts" },
  { href: "/admin/billing", label: "All customers (billing)" },
  { href: "/authority", label: "Site authority (ours)" },
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
  isPlatformAdmin = false,
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
  /** Whether to show the platform-owner tools group. */
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [localPaused, setLocalPaused] = useState(automationPaused);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const counts = { review: reviewCount, calls: callCount };

  useEffect(() => {
    setLocalPaused(automationPaused);
  }, [automationPaused]);

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

  async function handleToggleAutomation() {
    if (togglingAutomation) return;
    setTogglingAutomation(true);
    const next = !localPaused;
    setLocalPaused(next);
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
      });
      if (!res.ok) setLocalPaused(!next);
    } catch {
      setLocalPaused(!next);
    } finally {
      setTogglingAutomation(false);
    }
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const moreHasActive = MORE.some((g) => g.items.some((i) => isActive(i.href)));
  const moreNeedsAttention = reviewCount > 0;
  const initials =
    email
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
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
          {index != null && (
            <span
              className={`num shrink-0 text-[0.65rem] tracking-wider ${
                active ? "text-gold" : "text-muted-foreground/70"
              }`}
            >
              {padIndex(index)}
            </span>
          )}
          <span className="min-w-0">
            <span className={compact ? "" : "block text-sm"}>{item.label}</span>
            {!compact && item.hint && (
              <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
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
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 bg-background px-3 dark:border-white/10 md:hidden">
        <Link
          href="/today"
          className="inline-flex min-w-0 max-w-[42%] items-center overflow-hidden"
          style={{ height: "1.5rem" }}
          aria-label="Brost Co Today"
        >
          <ThemeWordmark className="h-full w-auto max-w-full" />
        </Link>

        <div className="flex-1" />

        <ThemeToggle compact className="mr-1 shrink-0" />

        {localPaused && (
          <button
            type="button"
            onClick={handleToggleAutomation}
            disabled={togglingAutomation}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-review/50 bg-review/10 px-2.5 py-1 text-[11px] text-foreground/80 transition-colors active:bg-review/25 disabled:opacity-50"
            aria-label="Automation paused, tap to resume"
          >
            <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-review" />
            Paused
          </button>
        )}

        <button
          type="button"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          <span aria-hidden className="text-xl leading-none">
            {open ? "✕" : "☰"}
          </span>
        </button>
      </div>

      <nav
        aria-label="Main"
        aria-hidden={isMobile && !open ? true : undefined}
        className={`fixed inset-0 z-[71] flex flex-col border-border/55 bg-background transition-transform duration-200 ease-out dark:border-white/10 md:static md:inset-auto md:z-auto md:h-full md:w-64 md:translate-x-0 md:border-r md:transition-none ${
          open
            ? "translate-x-0"
            : "pointer-events-none -translate-x-full md:pointer-events-auto"
        }`}
      >
        <div className="hidden shrink-0 px-5 py-6 md:block">
          <Link href="/today" className="block" aria-label="Brost Co Today">
            <ThemeWordmark className="h-7 w-auto" />
            <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Workspace
            </p>
          </Link>
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/55 px-4 dark:border-white/10 md:hidden">
          <div className="inline-flex items-center" style={{ height: "1.75rem" }}>
            <ThemeWordmark className="h-full w-auto" />
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <span aria-hidden className="text-xl leading-none">
              ✕
            </span>
          </button>
        </div>

        <div className="shrink-0 border-b border-border/55 px-4 py-3 dark:border-white/10 md:hidden">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={`h-2 w-2 shrink-0 rounded-full ${
                localPaused ? "bg-review" : "animate-pulse bg-pursue"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {localPaused ? "Automation paused" : "Automation running"}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {localPaused
                  ? "No agents, emails, or jobs will run"
                  : "Agents and scheduled jobs are live"}
              </p>
            </div>
            <button
              type="button"
              onClick={handleToggleAutomation}
              disabled={togglingAutomation}
              className={`shrink-0 text-xs disabled:opacity-50 ${
                localPaused ? "btn-primary" : "shell-ghost"
              }`}
            >
              {togglingAutomation ? "…" : localPaused ? "Resume" : "Pause"}
            </button>
          </div>
        </div>

        <div className="shrink-0 space-y-1.5 px-3 pb-2 pt-3 md:px-4 md:pt-0">
          <SearchButton className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border/55 bg-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground dark:border-white/15 md:min-h-0 md:py-1.5" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event("open-guide-wizard"));
            }}
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border/55 bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-gold/40 hover:bg-gold/10 hover:text-gold dark:border-white/15 md:min-h-0 md:py-1.5"
          >
            <span aria-hidden className="text-gold">
              ?
            </span>
            Guide Me
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:overflow-y-auto md:px-4 md:pb-3">
          <p className="mb-2 px-3 text-[0.65rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
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
              className="flex min-h-11 w-full items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground md:min-h-0 md:py-1.5"
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
                className={`text-xs text-muted-foreground transition-transform ${
                  moreOpen || moreHasActive ? "rotate-180" : ""
                }`}
              >
                ▾
              </span>
            </button>

            {(moreOpen || moreHasActive) && (
              <div className="mt-1 space-y-3 pb-2">
                {[
                  ...MORE,
                  ...(isPlatformAdmin
                    ? [{ section: "Platform admin", items: PLATFORM_ADMIN_ITEMS }]
                    : []),
                ].map((group) => (
                  <div key={group.section}>
                    <p className="mb-1 px-3 text-[0.6rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
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
              localPaused
                ? "border-review/40 bg-review/10 text-foreground"
                : "border-border/55 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground dark:border-white/10"
            }`}
          >
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  localPaused
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

        <div className="shrink-0 space-y-3 border-t border-border/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10">
          {/* Desktop: theme lives in the sidebar. Mobile header already has the toggle. */}
          <ThemeToggle className="hidden w-full justify-stretch md:inline-flex [&>button]:flex-1" />
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border-strong/40 text-xs font-medium text-foreground dark:border-white/20">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <button
                onClick={logout}
                className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
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
