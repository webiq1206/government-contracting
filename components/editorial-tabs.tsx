"use client";

import {
  useCallback,
  useEffect,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface EditorialTab {
  id: string;
  label: string;
  content: ReactNode;
}

/**
 * Editorial tab bar + mounted panels (hidden when inactive).
 * Syncs with URL hash and listens for `editorial-open-tab` / guide focus events
 * so deep links and Guide Me can reveal the right panel.
 *
 * `layout`:
 * - `sticky` (default): tab bar sticks inside a parent scroller (opportunity, etc.).
 * - `fill`: tab bar is fixed chrome; only panel content scrolls. Use under
 *   settings section nav so the two menus never compete for sticky offsets.
 */
export function EditorialTabs({
  tabs,
  ariaLabel,
  defaultTab,
  hashAliases,
  banner,
  stickyTopClass = "top-0",
  layout = "sticky",
}: {
  tabs: EditorialTab[];
  ariaLabel: string;
  defaultTab?: string;
  /** Map hash fragment -> tab id (e.g. quotes -> pricing). */
  hashAliases?: Record<string, string>;
  banner?: ReactNode;
  /** Sticky offset when nested under another sticky bar. Ignored for `fill`. */
  stickyTopClass?: string;
  layout?: "sticky" | "fill";
}) {
  const reactId = useId();
  const initial =
    defaultTab && tabs.some((t) => t.id === defaultTab)
      ? defaultTab
      : tabs[0]?.id ?? "";
  const [tab, setTab] = useState(initial);

  const resolveHash = useCallback(
    (raw: string) => {
      if (!raw) return null;
      if (tabs.some((t) => t.id === raw)) return raw;
      if (hashAliases?.[raw]) return hashAliases[raw];
      return null;
    },
    [tabs, hashAliases]
  );

  const go = useCallback(
    (id: string, syncHash = true) => {
      if (!tabs.some((t) => t.id === id)) return;
      setTab(id);
      if (syncHash && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.hash = id;
        window.history.replaceState(null, "", url.toString());
      }
    },
    [tabs]
  );

  useEffect(() => {
    function applyHash() {
      const raw = window.location.hash.replace(/^#/, "");
      const id = resolveHash(raw);
      if (id) setTab(id);
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [resolveHash]);

  useEffect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<{ tab?: string; target?: string }>).detail;
      if (detail?.tab) {
        go(detail.tab, false);
        return;
      }
      if (detail?.target) {
        const el =
          document.querySelector<HTMLElement>(
            `[data-guide-target="${detail.target}"]`
          ) || document.getElementById(detail.target);
        const panel = el?.closest<HTMLElement>("[data-editorial-panel]");
        const id = panel?.dataset.editorialPanel;
        if (id) go(id, false);
      }
    }
    window.addEventListener("editorial-open-tab", onOpen);
    return () => window.removeEventListener("editorial-open-tab", onOpen);
  }, [go]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = tabs.findIndex((t) => t.id === tab);
    if (idx < 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next =
        e.key === "ArrowRight"
          ? tabs[(idx + 1) % tabs.length]
          : tabs[(idx - 1 + tabs.length) % tabs.length];
      go(next.id);
      document.getElementById(`${reactId}-tab-${next.id}`)?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      go(tabs[0].id);
      document.getElementById(`${reactId}-tab-${tabs[0].id}`)?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      const last = tabs[tabs.length - 1];
      go(last.id);
      document.getElementById(`${reactId}-tab-${last.id}`)?.focus();
    }
  }

  const tablist = (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={
        layout === "fill"
          ? "flex shrink-0 gap-4 overflow-x-auto border-b border-border bg-background px-4 py-1.5 sm:gap-5 sm:px-6 sm:py-2"
          : `flex gap-5 overflow-x-auto border-y border-border bg-background/95 px-5 py-2.5 backdrop-blur sm:px-6 sm:py-3 md:sticky md:z-20 ${stickyTopClass}`
      }
    >
      {tabs.map((t) => {
        const active = tab === t.id;
        const tabClass =
          layout === "fill"
            ? active
              ? "dash-tab dash-tab--active whitespace-nowrap text-xs uppercase tracking-[0.1em]"
              : "dash-tab whitespace-nowrap text-xs uppercase tracking-[0.1em]"
            : active
              ? "dash-tab dash-tab--active whitespace-nowrap uppercase tracking-[0.12em]"
              : "dash-tab whitespace-nowrap uppercase tracking-[0.12em]";
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${reactId}-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`${reactId}-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => go(t.id)}
            className={tabClass}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );

  const panels = tabs.map((t) => {
    const active = tab === t.id;
    return (
      <div
        key={t.id}
        role="tabpanel"
        id={`${reactId}-panel-${t.id}`}
        aria-labelledby={`${reactId}-tab-${t.id}`}
        data-editorial-panel={t.id}
        hidden={!active}
        className={active ? "block" : "hidden"}
      >
        {t.content}
      </div>
    );
  });

  if (layout === "fill") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {banner}
        {tablist}
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{panels}</div>
      </div>
    );
  }

  return (
    <div>
      {banner}
      {tablist}
      {panels}
    </div>
  );
}
