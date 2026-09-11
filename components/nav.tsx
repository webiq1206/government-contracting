"use client";

import { PendingLink as Link } from "@/components/pending-link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useMenuIsolation } from "./menu-isolation";
import { ThemeWordmark } from "./theme-wordmark";
import { Wordmark } from "./wordmark";
import { ThemeToggle } from "./theme-toggle";
import { SearchButton } from "./command-palette";
import { CloseIcon, MenuIcon } from "./tab-icons";
import { NAVIGATION_SECTIONS, navigationMatches, type NavigationItem as Item, type NavigationSection as Section } from "@/lib/navigation";
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
 *
 * The overlay is kept through tablet portrait, and the sidebar appears at
 * 1024 rather than 768.
 *
 * At 768 the sidebar was 256px, which is a third of an iPad in portrait spent
 * on navigation, on the device where the content column is already tightest:
 * a table that fits at 768 does not fit at 512. The brief offers two ways out,
 * a compact icon rail or keeping the bottom bar to the wider breakpoint, and
 * the rail is the wrong one here. There are twenty-five destinations in eight
 * named groups, and an icon rail either shows twenty-five glyphs, which is
 * unreadable and is the thing the tab-bar icons were just rescued from, or
 * hides the groups behind hover, which does not exist on a tablet.
 *
 * So tablet portrait is a touch layout: the drawer, the five bottom tabs, and
 * the full width for the work. Everything keyed to that decision moves with
 * it, including the 44px minimum on buttons, which a device held in one hand
 * needs at 900px exactly as much as at 390.
 */

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

function NavigationRow({ item, compact = false, active, badge, onNavigate }: { item: Item; compact?: boolean; active: boolean; badge: number; onNavigate: () => void }) {
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={`flex coarse:min-h-11 items-center justify-between gap-2 rounded-md pr-2 transition-colors ${
          compact ? "py-2.5 pl-3 text-sm lg:py-1.5" : "py-2.5 pl-3 lg:py-2"
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
          <span className="badge shrink-0 rounded-full bg-gold px-1.5 text-on-accent">
            {badge}
          </span>
        )}
      </Link>
    );
  }


export function Nav({
  email,
  reviewCount,
  callCount,
  automationState,
  automationHeadline,
  automationDetail,
  automationPaused,
  isPlatformAdmin = false,
  canPauseAutomation = false,
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
  canPauseAutomation?: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const panelRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const { setOpen: isolateBackground } = useMenuIsolation();
  /**
   * Which groups the operator has explicitly toggled. A group is open when
   * they opened it, or when it holds the page they are on -- so arriving at
   * Compliance from a link never leaves the sidebar looking like Compliance
   * is somewhere else.
   */
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [isMobile, setIsMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const previousPath = useRef(pathname);
  const [localPaused, setLocalPaused] = useState(automationPaused);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const counts = { review: reviewCount, calls: callCount };

  useEffect(() => {
    setLocalPaused(automationPaused);
  }, [automationPaused]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    setReady(true);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (previousPath.current !== pathname) setOpen(false);
    previousPath.current = pathname;
  }, [pathname]);

  useEffect(() => {
    isolateBackground(open && isMobile);
    return () => isolateBackground(false);
  }, [open, isMobile, isolateBackground]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const panel = panelRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), a[href], input:not([disabled]), [tabindex='0']"
    ) ?? []).filter(node => node.getClientRects().length > 0);
    (focusable()[0] ?? panel)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
      if (e.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (!first || !last) { e.preventDefault(); panel?.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, isMobile]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST", signal: AbortSignal.timeout(20_000) });
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
      window.location.replace("/login");
    } catch {
      setLogoutError("Could not sign out. Check your connection and try again.");
    } finally {
      setLoggingOut(false);
    }
  }

  async function handleToggleAutomation() {
    if (togglingAutomation || automationPaused === undefined) return;
    setTogglingAutomation(true);
    setAutomationError(null);
    const next = !localPaused;
    setLocalPaused(next);
    try {
      const res = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        setLocalPaused(!next);
        setAutomationError(res.status === 403
          ? "Your role cannot change automation. Ask an account owner or administrator to update it."
          : "The automation change was not confirmed. Open Automation Health to check the current state before trying again.");
      }
      /*
       * Refresh so the authoritative health state catches up.
       *
       * Without it the optimistic boolean and the measured state disagreed
       * until the next navigation, which is the whole reason the mobile strip
       * below reads the state rather than the boolean: pausing an account
       * whose credits are exhausted and then resuming it must go back to
       * saying the credits are exhausted, not to saying everything is fine.
       */
      else router.refresh();
    } catch {
      setLocalPaused(!next);
      setAutomationError("The automation change was not confirmed. Open Automation Health to check the current state before trying again.");
    } finally {
      setTogglingAutomation(false);
    }
  }

  /*
   * What the mobile strip says, and where each part comes from.
   *
   * The pause Boolean answers "did somebody press Pause". The health state
   * answers "is the work getting done", and those are different questions:
   * an account with no AI key is not paused and is not working.
   *
   * The one moment the Boolean wins is the optimistic window between pressing
   * the button and the server component coming back, when the measured state
   * is describing the account as it was a second ago.
   */
  const togglePending = localPaused !== automationPaused;
  const mobileState: AutomationState = togglePending
    ? localPaused
      ? "paused"
      : "healthy"
    : (automationState ?? (localPaused ? "paused" : "degraded"));
  const mobileHeadline = togglePending
    ? localPaused
      ? "Pausing automation"
      : "Resuming automation"
    : (automationHeadline ??
      (localPaused ? "Automation paused" : "Automation status unavailable"));
  const mobileDetail = togglePending
    ? "Saving that now"
    : (automationDetail ??
      (localPaused
        ? "No agents, emails, or jobs will run"
        : "Open Automation Health to check whether work is running"));

  const isActive = (href: string) => navigationMatches(pathname, href);
  const sections = NAVIGATION_SECTIONS.filter((sec) => !sec.adminOnly || isPlatformAdmin);
  const sectionHasActive = (sec: Section) => sec.items.some((i) => isActive(i.href));
  const sectionBadgeTotal = (sec: Section) =>
    sec.items.reduce((n, i) => n + (i.badge ? counts[i.badge] : 0), 0);
  // Work is where a day starts, so it opens without being asked.
  const isSectionOpen = (sec: Section) =>
    sectionHasActive(sec) || (openSections[sec.key] ?? sec.key === "work");
  const initials =
    email
      .split("@")[0]
      .split(/[.\-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "BC";


  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 bg-background px-3 dark:border-white/10 lg:hidden">
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

        <SearchButton
          iconOnly
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        />

        {localPaused && canPauseAutomation && (
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
          disabled={!ready}
          aria-expanded={open}
        >
          {open ? <CloseIcon /> : <MenuIcon />}
        </button>
      </div>

      <nav
        ref={panelRef}
        tabIndex={-1}
        inert={isMobile && !open ? true : undefined}
        aria-label="Main"
        aria-hidden={isMobile && !open ? true : undefined}
        className={`app-navigation fixed inset-0 z-[71] flex flex-col border-border/55 bg-shell transition-transform duration-200 ease-out dark:border-white/10 lg:static lg:inset-auto lg:z-auto lg:h-full lg:w-[232px] lg:translate-x-0 lg:border-r lg:transition-none ${
          open
            ? "visible translate-x-0"
            : "invisible pointer-events-none -translate-x-full lg:visible lg:pointer-events-auto"
        }`}
      >
        <div className="hidden shrink-0 px-5 py-5 lg:block">
          {/* min-h-11 on touch: the wordmark is the app bar's route home and
              was a 24px-tall target, the smallest on every mobile screen. */}
          <Link
            href="/today"
            className="flex coarse:min-h-11 items-center lg:block"
            aria-label="Brost Co Today"
          >
            <Wordmark variant="light" className="h-7 w-auto" />
            <p className="mt-2 text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
              Workspace
            </p>
          </Link>
        </div>

        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/55 px-4 dark:border-white/10 lg:hidden">
          <div className="inline-flex items-center" style={{ height: "1.75rem" }}>
            <Wordmark variant="light" className="h-full w-auto" />
          </div>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        {/*
          The authoritative state, not the local Boolean.
          This strip used to read `localPaused` alone, so an account whose
          every job was failing on an exhausted credit balance was told
          "Automation running. Agents and scheduled jobs are live", which is
          the same lie the sidebar chip was rebuilt to stop telling. The
          Boolean says whether anybody pressed Pause; it does not say whether
          the work is getting done.
        */}
        <div className="shrink-0 border-b border-border/55 px-4 py-3 dark:border-white/10 lg:hidden">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={`shrink-0 font-mono text-xs ${
                mobileState === "healthy" ? "text-pursue" : "text-foreground"
              }`}
            >
              {CHIP_GLYPH[mobileState]}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{mobileHeadline}</p>
              <p className="text-[11px] text-muted-foreground">{mobileDetail}</p>
            </div>
            {canPauseAutomation && <button
              type="button"
              onClick={handleToggleAutomation}
              disabled={togglingAutomation || automationPaused === undefined}
              className={`shrink-0 text-xs disabled:opacity-50 ${
                localPaused ? "btn-primary" : "shell-ghost"
              }`}
            >
              {togglingAutomation ? "…" : localPaused ? "Resume" : "Pause"}
            </button>}
          </div>
          {automationError && (
            <p role="alert" className="mt-2 text-sm text-risk">
              {automationError}{" "}
              <Link href="/agents" className="underline">Check automation</Link>
            </p>
          )}
        </div>

        <div className="shrink-0 space-y-1.5 px-3 pb-2 pt-3 lg:px-4 lg:pt-0">
          <SearchButton className="flex coarse:min-h-11 w-full items-center gap-2 rounded-md border border-border/55 bg-surface px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground dark:border-white/15 py-1.5" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              window.dispatchEvent(new Event("open-guide-wizard"));
            }}
            className="flex coarse:min-h-11 w-full items-center gap-2 rounded-md border border-border/55 bg-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-gold/40 hover:bg-gold/10 hover:text-gold-text dark:border-white/15 py-1.5"
          >
            <span aria-hidden className="text-gold-text">
              ?
            </span>
            Guide me
          </button>
        </div>

        <div className="scroll-thin flex-1 space-y-0.5 overflow-y-auto p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:overflow-y-auto lg:px-3 lg:pb-3">
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
                  className="flex coarse:min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left transition-colors hover:text-foreground py-1.5"
                >
                  {/* A heading, not another dim menu item: a rule above it,
                      real weight, and separation from the links beneath. */}
                  <span className="flex items-center gap-2 text-xs font-semibold text-foreground/70">
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
                        <NavigationRow item={item} compact active={isActive(item.href)} badge={item.badge ? counts[item.badge] : 0} onNavigate={() => setOpen(false)} />
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
        <div className="shrink-0 space-y-2 border-t border-border/55 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] dark:border-white/10">
          <ThemeToggle className="w-full justify-stretch [&>button]:flex-1" />
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
