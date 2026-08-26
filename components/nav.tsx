"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ThemeWordmark } from "./theme-wordmark";
import { ThemeToggle } from "./theme-toggle";
import { SearchButton } from "./command-palette";
import type { AutomationState } from "@/lib/domain/automation-health";

/**
 * Navigation as named sections rather than a short list plus a drawer.
 *
 * The previous shape put four destinations up front and everything else
 * behind "More". The intent was to stop fourteen equal-weight links implying
 * fourteen responsibilities, which was right; the cost was that Contracts,
 * Compliance, the Email Log and every settings page became things you had to
 * already know were there. Operational pages a person needs weekly should not
 * require opening a drawer to discover.
 *
 * So the pages are grouped by what they are FOR -- the work, the people, the
 * delivery, the reporting -- and every group is visible at rest. Groups
 * collapse, the one containing the current page is open, and a collapsed
 * group carries a dot when something inside it needs attention, so nothing
 * can hide.
 *
 * The 01-04 numbering is gone with it. Numbers promise a sequence, and these
 * are not steps: an operator moves between Today, an opportunity and the Call
 * Queue continuously, in whatever order the day takes.
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

interface Section {
  key: string;
  label: string;
  items: Item[];
  /** Platform-owner tools, hidden from customers entirely. */
  adminOnly?: boolean;
}

/**
 * The sections, in the order a working day tends to move through them.
 *
 * Names describe the job rather than the software: "Delivery" is what happens
 * after you win, "Performance" is how it went. A contractor should be able to
 * find a page from the noun in their head.
 */
const SECTIONS: Section[] = [
  {
    key: "work",
    label: "Work",
    items: [
      { href: "/today", label: "Today", hint: "Everything that needs you" },
      { href: "/pipeline", label: "Opportunities", hint: "Every opportunity, by whose turn it is" },
      { href: "/review", label: "Review", hint: "Borderline opportunities to pursue or pass", badge: "review" },
      { href: "/call-queue", label: "Call Queue", hint: "Work calls one after another", badge: "calls" },
    ],
  },
  {
    key: "relationships",
    label: "Relationships",
    items: [
      { href: "/subs", label: "Subcontractors" },
      { href: "/communications", label: "Communications" },
    ],
  },
  {
    key: "delivery",
    label: "Delivery",
    items: [
      { href: "/contracts", label: "Contracts" },
      { href: "/compliance", label: "Compliance" },
    ],
  },
  {
    key: "performance",
    label: "Performance",
    items: [
      { href: "/analytics", label: "Analytics" },
      { href: "/agents", label: "Automation Health", hint: "Whether the automation is working, and what is stopping it" },
    ],
  },
  {
    key: "help",
    label: "Help",
    // Guide Me is a panel rather than a page -- it opens over whatever you are
    // looking at, because its whole value is knowing where you are. Listing it
    // as a destination here would be a link that navigates nowhere.
    items: [{ href: "/how-it-works", label: "Knowledge Center" }],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { href: "/settings/profile", label: "Company" },
      { href: "/settings/rules", label: "Rules" },
      { href: "/settings/content", label: "Content" },
      { href: "/settings/integrations", label: "Integrations" },
      { href: "/settings/billing", label: "Billing" },
    ],
  },
  {
    key: "platform",
    label: "Platform Admin",
    adminOnly: true,
    items: [
      { href: "/admin/accounts", label: "Accounts" },
      { href: "/admin/invitations", label: "Invitations" },
      { href: "/admin/billing", label: "Customer Billing" },
    ],
  },
  {
    key: "optional",
    label: "Optional Tools",
    /*
     * Site Authority tracks OUR marketing domain's backlinks. It is
     * meaningless to a contractor and a window onto our own business, so it
     * stays admin-only and in its own group rather than sitting among the
     * pages a customer works in.
     */
    adminOnly: true,
    items: [{ href: "/authority", label: "Site Authority" }],
  },
];

/**
 * How each state looks. Deliberately five entries rather than a healthy/not
 * pair: "paused" and "not set up" are not faults and must not wear the fault
 * colour, or people learn to ignore the fault colour.
 */
const CHIP_STYLE: Record<AutomationState, string> = {
  healthy:
    "border-border/55 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground dark:border-white/10",
  degraded: "border-review/40 bg-review/10 text-foreground",
  blocked: "border-risk/50 bg-risk/10 text-foreground",
  paused: "border-review/40 bg-review/10 text-foreground",
  not_configured:
    "border-border/55 bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground dark:border-white/10",
};

const CHIP_GLYPH: Record<AutomationState, string> = {
  healthy: "\u25CF",
  degraded: "\u25B2",
  blocked: "\u2715",
  paused: "\u23F8",
  not_configured: "\u25CB",
};

export function Nav({
  email,
  reviewCount,
  callCount,
  automationState,
  automationHeadline,
  automationDetail,
  automationPaused = false,
  isPlatformAdmin = false,
}: {
  email: string;
  reviewCount: number;
  callCount: number;
  /**
   * The one automation state, from lib/domain/automation-health. Not a
   * boolean: "the worker is alive" and "the work is getting done" are
   * different questions, and this chip used to answer the first while
   * appearing to answer the second -- printing "Running normally" over an
   * account whose every job was failing on an exhausted credit balance.
   */
  automationState?: AutomationState;
  /** Six words. Whatever assessAutomation decided, verbatim. */
  automationHeadline?: string;
  /** The reason, for the title attribute and screen readers. */
  automationDetail?: string;
  /** Master kill switch is on; nothing automated will run. */
  automationPaused?: boolean;
  /** Whether to show the platform-owner tools group. */
  isPlatformAdmin?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /**
   * Which groups the operator has explicitly toggled. A group is open when
   * they opened it, or when it holds the page they are on -- so arriving at
   * Compliance from a link never leaves the sidebar looking like Compliance
   * is somewhere else.
   */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(false);
  const [localPaused, setLocalPaused] = useState(automationPaused);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
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
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      // Navigating on a failed request is the worst outcome: the session is
      // still live but the screen says otherwise, so the next visit silently
      // lands back in the app as a user who believes they signed out.
      if (!res.ok) {
        setLogoutError("Could not sign out. Check your connection and try again.");
        return;
      }
      // Close the drawer with everything else it holds: on a phone the nav is
      // a full-screen overlay, and leaving it mounted over the login page is
      // how a half-finished sign-out looks like a broken app.
      setOpen(false);
      router.push("/login");
      router.refresh();
    } catch {
      setLogoutError("Could not sign out. Check your connection and try again.");
    } finally {
      setLoggingOut(false);
    }
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
  const sections = SECTIONS.filter((sec) => !sec.adminOnly || isPlatformAdmin);
  const sectionHasActive = (sec: Section) => sec.items.some((i) => isActive(i.href));
  const sectionBadgeTotal = (sec: Section) =>
    sec.items.reduce((n, i) => n + (i.badge ? counts[i.badge] : 0), 0);
  // Work is where a day starts, so it opens without being asked.
  const isSectionOpen = (sec: Section) =>
    openSections[sec.key] ?? (sec.key === "work" || sectionHasActive(sec));
  const initials =
    email
      .split("@")[0]
      .split(/[.\-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "BC";

  function Row({ item, compact = false }: { item: Item; compact?: boolean }) {
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
            ? "bg-gold/15 font-medium text-gold-text"
            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
        }`}
      >
        <span className="flex min-w-0 items-baseline gap-2.5">
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
        {/*
          The app bar's route home, and it was a 24px-tall target: the smallest
          interactive thing on every mobile screen, and the one people reach
          for by habit. The wordmark itself stays 24px; the LINK is 44, which
          is what a thumb actually has to find.
        */}
        <Link
          href="/today"
          className="inline-flex min-h-11 min-w-0 max-w-[42%] items-center overflow-hidden"
          aria-label="Brost Co Today"
        >
          <ThemeWordmark className="h-6 w-auto max-w-full" />
        </Link>

        <div className="flex-1" />

        <ThemeToggle compact className="mr-1 shrink-0" />

        {localPaused && (
          <button
            type="button"
            onClick={handleToggleAutomation}
            disabled={togglingAutomation}
            className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-review/50 bg-review/10 px-3 py-1 text-[11px] text-foreground/80 transition-colors active:bg-review/25 disabled:opacity-50"
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
          {/* min-h-11 on touch: the wordmark is the app bar's route home and
              was a 24px-tall target, the smallest on every mobile screen. */}
          <Link
            href="/today"
            className="flex min-h-11 items-center md:block md:min-h-0"
            aria-label="Brost Co Today"
          >
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
            className="flex min-h-11 w-full items-center gap-2 rounded-md border border-border/55 bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-gold/40 hover:bg-gold/10 hover:text-gold-text dark:border-white/15 md:min-h-0 md:py-1.5"
          >
            <span aria-hidden className="text-gold-text">
              ?
            </span>
            Guide Me
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] md:overflow-y-auto md:px-4 md:pb-3">
          {sections.map((sec) => {
            const open = isSectionOpen(sec);
            const waiting = sectionBadgeTotal(sec);
            return (
              <div key={sec.key} className="pt-1 first:pt-0">
                <button
                  type="button"
                  onClick={() =>
                    setOpenSections((prev) => ({ ...prev, [sec.key]: !open }))
                  }
                  aria-expanded={open}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:text-foreground md:min-h-0 md:py-1.5"
                >
                  {/* A heading, not another dim menu item: a rule above it,
                      real weight, and separation from the links beneath. */}
                  <span className="flex items-center gap-2 text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-foreground/70">
                    <span aria-hidden className="h-px w-3 shrink-0 bg-gold/70" />
                    {sec.label}
                    {/* Collapsed groups must not be able to hide work. */}
                    {waiting > 0 && !open && (
                      <span
                        aria-label={`${waiting} waiting`}
                        className="inline-block h-1.5 w-1.5 rounded-full bg-gold"
                      />
                    )}
                  </span>
                  <span
                    aria-hidden
                    className={`text-xs text-muted-foreground transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  >
                    ▾
                  </span>
                </button>

                {open && (
                  <ul className="mb-1 space-y-0.5">
                    {sec.items.map((item) => (
                      <li key={item.href}>
                        <Row item={item} compact={sec.key !== "work"} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {automationHeadline && (
          <Link
            href="/agents"
            onClick={() => setOpen(false)}
            title={automationDetail}
            className={`mx-3 mb-2 flex min-h-11 shrink-0 flex-col justify-center rounded-md border px-3 py-3 text-xs transition-colors ${
              CHIP_STYLE[automationState ?? "healthy"]
            }`}
          >
            <span className="flex items-center gap-2">
              {/*
                Glyph and colour together, never colour alone. A red dot and an
                amber dot are the same dot to a red-green colourblind operator,
                and this chip is the one place the whole system reports whether
                it is working.
              */}
              <span aria-hidden className="shrink-0 font-mono">
                {CHIP_GLYPH[automationState ?? "healthy"]}
              </span>
              <span className="min-w-0 truncate">{automationHeadline}</span>
            </span>
            {automationDetail && (
              <span className="sr-only"> {automationDetail}</span>
            )}
          </Link>
        )}

        {/* The account menu, and the only place sign-out lives on a phone.
            It used to be a muted 12px text link tucked under the email, which
            is present without being findable: reachable only by opening the
            drawer, scrolling past every link, and spotting grey-on-grey text.
            Now it is a real control with a thumb-sized target. */}
        <div className="shrink-0 space-y-3 border-t border-border/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10">
          {/* Desktop: theme lives in the sidebar. Mobile header already has the toggle. */}
          <ThemeToggle className="hidden w-full justify-stretch md:inline-flex [&>button]:flex-1" />
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center border border-border-strong/40 text-xs font-medium text-foreground dark:border-white/20">
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                Signed in as
              </p>
              <p className="truncate text-xs text-foreground">{email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-border/55 px-3 text-sm text-foreground transition-colors hover:border-border-strong hover:bg-surface disabled:opacity-60 dark:border-white/10"
          >
            <span aria-hidden>⏻</span>
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
          {logoutError && (
            <p role="alert" className="text-xs text-risk">
              {logoutError}
            </p>
          )}
        </div>
      </nav>
    </>
  );
}
