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
import {
  NAVIGATION_SECTIONS,
  navigationMatches,
  type NavigationItem,
  type NavigationSection,
} from "@/lib/navigation";
import type { AutomationState } from "@/lib/domain/automation-health";

const CHIP_GLYPH: Record<AutomationState, string> = {
  healthy: "●",
  degraded: "▲",
  blocked: "×",
  paused: "Ⅱ",
  not_configured: "○",
};

const STATE_TONE: Record<AutomationState, string> = {
  healthy: "text-pursue",
  degraded: "text-review",
  blocked: "text-risk",
  paused: "text-review",
  not_configured: "text-muted-foreground",
};

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={`flex min-h-11 items-center rounded-lg px-3 text-sm font-medium transition-colors ${
        active
          ? "bg-accent text-on-accent"
          : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
      }`}
    >
      {item.label}
    </Link>
  );
}

function NavGroup({
  section,
  pathname,
  onNavigate,
}: {
  section: NavigationSection;
  pathname: string;
  onNavigate: () => void;
}) {
  const active = section.items.some((item) => navigationMatches(pathname, item.href));
  return (
    <details className="group" open={active || undefined}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between rounded-lg px-3 text-sm font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground [&::-webkit-details-marker]:hidden">
        <span>{section.label}</span>
        <span aria-hidden className="text-xs transition-transform group-open:rotate-180">⌄</span>
      </summary>
      <div className="mt-1 space-y-0.5 border-l border-white/10 pl-2">
        {section.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={navigationMatches(pathname, item.href)}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </details>
  );
}

export function Nav({
  email,
  reviewCount: _reviewCount,
  callCount: _callCount,
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
  automationState?: AutomationState;
  automationHeadline?: string;
  automationDetail?: string;
  automationPaused?: boolean;
  isPlatformAdmin?: boolean;
  canPauseAutomation?: boolean;
}) {
  void _reviewCount;
  void _callCount;
  const pathname = usePathname();
  const router = useRouter();
  const drawerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const [localPaused, setLocalPaused] = useState(automationPaused);
  const [togglingAutomation, setTogglingAutomation] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [automationError, setAutomationError] = useState<string | null>(null);
  const { setOpen: isolateBackground } = useMenuIsolation();

  useEffect(() => setLocalPaused(automationPaused), [automationPaused]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const sync = () => setIsMobile(mq.matches);
    sync();
    setReady(true);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    isolateBackground(open && isMobile);
    return () => isolateBackground(false);
  }, [open, isMobile, isolateBackground]);

  useEffect(() => {
    if (!open || !isMobile) return;
    const panel = drawerRef.current;
    const opener = document.activeElement as HTMLElement | null;
    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), a[href], input:not([disabled]), [tabindex='0']"
        ) ?? []
      ).filter((node) => node.getClientRects().length > 0);

    (focusable()[0] ?? panel)?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.removeEventListener("keydown", onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open, isMobile]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError(null);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        setLogoutError("Could not sign out. Try again.");
        return;
      }
      window.location.replace("/login");
    } catch {
      setLogoutError("Could not sign out. Try again.");
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
      const response = await fetch("/api/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: next }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) {
        setLocalPaused(!next);
        setAutomationError(
          response.status === 403
            ? "Your role cannot change automation."
            : "That change was not confirmed. Check Automation."
        );
      } else {
        router.refresh();
      }
    } catch {
      setLocalPaused(!next);
      setAutomationError("That change was not confirmed. Check Automation.");
    } finally {
      setTogglingAutomation(false);
    }
  }

  const togglePending = localPaused !== automationPaused;
  const mobileState: AutomationState = togglePending && localPaused
    ? "paused"
    : automationState ?? (localPaused ? "paused" : "not_configured");
  const mobileHeadline = togglePending
    ? localPaused
      ? "Pausing automation"
      : "Resuming automation"
    : automationHeadline ??
      (mobileState === "healthy"
        ? "Automation healthy"
        : mobileState === "degraded"
          ? "Automation needs attention"
          : mobileState === "blocked"
            ? "Automation is blocked"
            : mobileState === "paused"
              ? "Automation paused"
              : "Automation not configured");
  const mobileDetail = togglePending
    ? "Saving this change now."
    : automationDetail ??
      (mobileState === "healthy"
        ? "Agents and scheduled work are running."
        : mobileState === "degraded"
          ? "Some automated work needs review."
          : mobileState === "blocked"
            ? "Open Automation to see what is stopping work."
            : mobileState === "paused"
              ? "Automated work is paused for this account."
              : "Finish setup before automated work can run.");

  const sections = NAVIGATION_SECTIONS.filter(
    (section) => !section.adminOnly || isPlatformAdmin
  );
  const primary = sections.find((section) => section.key === "primary")!;
  const secondary = sections.filter((section) => section.key !== "primary");
  const initials =
    email
      .split("@")[0]
      .split(/[.\-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2) || "BC";

  const navBody = (
    <>
      <div className="space-y-0.5">
        {primary.items.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={navigationMatches(pathname, item.href)}
            onNavigate={() => setOpen(false)}
          />
        ))}
      </div>

      <div className="my-4 border-t border-white/10" />

      <div className="space-y-1">
        {secondary.map((section) => (
          <NavGroup
            key={section.key}
            section={section}
            pathname={pathname}
            onNavigate={() => setOpen(false)}
          />
        ))}
      </div>
    </>
  );

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 lg:hidden">
        <Link href="/today" className="inline-flex min-h-11 items-center" aria-label="Brost Co Today">
          <ThemeWordmark className="h-6 w-auto" />
        </Link>
        <div className="flex-1" />
        <SearchButton
          iconOnly
          className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
        />
        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          aria-expanded={open}
          disabled={!ready}
        >
          <MenuIcon />
        </button>
      </header>

      {open && isMobile && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-[70] bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <nav
        ref={drawerRef}
        tabIndex={-1}
        aria-label="Main"
        aria-hidden={isMobile && !open ? true : undefined}
        inert={isMobile && !open ? true : undefined}
        className={`app-navigation fixed inset-y-0 right-0 z-[71] flex w-[min(88vw,360px)] flex-col border-l border-white/10 bg-shell transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-dvh lg:w-[220px] lg:translate-x-0 lg:border-l-0 lg:border-r ${
          open ? "translate-x-0" : "translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4 lg:h-auto lg:border-b-0 lg:px-5 lg:py-5">
          <Link href="/today" onClick={() => setOpen(false)} aria-label="Brost Co Today">
            <Wordmark variant="light" className="h-7 w-auto" />
          </Link>
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground lg:hidden"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto px-3 py-3 lg:px-3 lg:pt-1">
          {navBody}
        </div>

        <div className="shrink-0 space-y-3 border-t border-white/10 p-3 pb-[max(.75rem,env(safe-area-inset-bottom))]">
          <Link
            href="/agents"
            onClick={() => setOpen(false)}
            title={mobileDetail}
            className="flex min-h-11 items-start gap-2 rounded-lg px-3 py-2 text-muted-foreground hover:bg-white/5 hover:text-foreground"
          >
            <span aria-hidden className={`mt-0.5 ${STATE_TONE[mobileState]}`}>{CHIP_GLYPH[mobileState]}</span>
            <span className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">{mobileHeadline}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{mobileDetail}</p>
            </span>
          </Link>

          {canPauseAutomation && automationPaused !== undefined && (
            <button
              type="button"
              onClick={handleToggleAutomation}
              disabled={togglingAutomation}
              className="min-h-11 w-full rounded-lg border border-white/15 px-3 text-sm text-foreground hover:bg-white/5 disabled:opacity-50"
            >
              {togglingAutomation ? "Saving…" : localPaused ? "Resume automation" : "Pause automation"}
            </button>
          )}
          {automationError && <p role="alert" className="px-1 text-xs text-risk">{automationError}</p>}

          <ThemeToggle className="w-full justify-stretch [&>button]:flex-1" />

          <div className="flex items-center gap-3 px-1">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-xs font-medium text-foreground">
              {initials}
            </span>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{email}</p>
          </div>

          <button
            type="button"
            onClick={logout}
            disabled={loggingOut}
            className="min-h-11 w-full rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-50"
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
          {logoutError && <p role="alert" className="px-1 text-xs text-risk">{logoutError}</p>}
        </div>
      </nav>
    </>
  );
}
