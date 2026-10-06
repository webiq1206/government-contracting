"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { recordParent } from "@/lib/navigation";

type ReturnContext = { href: string; label: string };
type Snapshot = { top: number; areas: number[]; focusId: string; focusHref: string };
type Memory = { snapshots: Record<string, Snapshot>; returns: Record<string, ReturnContext>; restore?: string; at: number };
const Context = createContext<ReturnContext | null>(null);
const lists: Record<string, string> = { "/today": "Today", "/review": "Review", "/pipeline": "Opportunities", "/workbench": "All tasks", "/search": "Search", "/subs": "Subcontractors", "/contracts": "Contracts", "/communications": "Inbox", "/communications/history": "Communication history", "/recap": "Daily recap", "/compliance": "Compliance", "/activity": "Activity", "/admin/accounts": "Accounts" };
function originLabel(path: string): string | null {
  if (lists[path]) return lists[path];
  if (/^\/(?:subs|opportunity|contracts|admin\/accounts)\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(path)) return path.startsWith("/subs/") ? "Contact record" : "Record";
  return null;
}

export function safeWorkspaceReturn(value: string): string | null {
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\r\n]/.test(value)) return null;
  try {
    const url = new URL(value, "https://workspace.invalid");
    if (url.origin !== "https://workspace.invalid" || !originLabel(url.pathname)) return null;
    return url.pathname + url.search + url.hash;
  } catch { return null; }
}

function areas() {
  return Array.from(document.querySelectorAll<HTMLElement>("main, main *")).filter(node => node.clientHeight > 100 && /auto|scroll/.test(getComputedStyle(node).overflowY));
}

/** Session-only UI state, partitioned by organization. Never stores credentials or record data. */
export function NavigationMemory({ scope, children }: { scope: string; children: ReactNode }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const route = pathname + (params.size ? `?${params}` : "");
  const key = `brostco:navigation:${scope}`;
  const [back, setBack] = useState<{ key: string; path: string; value: ReturnContext | null } | null>(null);
  useEffect(() => {
    const read = (): Memory => {
      try {
        const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Memory | null;
        if (value && value.at > Date.now() - 3_600_000 && value.snapshots && value.returns) return value;
      } catch { /* Browser storage is optional. */ }
      return { snapshots: {}, returns: {}, at: Date.now() };
    };
    const write = (memory: Memory) => {
      memory.at = Date.now();
      // Bound history held by a long-running tab.
      memory.snapshots = Object.fromEntries(Object.entries(memory.snapshots).slice(-30));
      memory.returns = Object.fromEntries(Object.entries(memory.returns).slice(-30));
      try { sessionStorage.setItem(key, JSON.stringify(memory)); } catch { /* Links still work. */ }
    };
    const current = read();
    const saved = current.returns[pathname];
    setBack({ key, path: pathname, value: saved && safeWorkspaceReturn(saved.href) ? saved : null });

    function remember(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.defaultPrevented) return;
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.target === "_blank" || link.hasAttribute("download")) return;
      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin) return;
      const memory = read();
      const here = location.pathname + location.search + location.hash;
      memory.snapshots[here] = { top: window.scrollY, areas: areas().map(node => node.scrollTop), focusId: link.id, focusHref: link.getAttribute("href") ?? "" };
      const label = originLabel(location.pathname);
      if (link.dataset.restoreContext !== "true" && (recordParent(target.pathname) || target.pathname === "/communications/compose") && label && safeWorkspaceReturn(here)) memory.returns[target.pathname] = { href: here, label };
      if (link.dataset.restoreContext === "true") memory.restore = target.pathname + target.search + target.hash;
      write(memory);
    }
    const pop = () => { const memory = read(); memory.restore = location.pathname + location.search + location.hash; write(memory); };
    document.addEventListener("click", remember, true);
    window.addEventListener("popstate", pop);

    const here = location.pathname + location.search + location.hash;
    let cleanup = () => {};
    if (current.restore === here && current.snapshots[here]) {
      const snapshot = current.snapshots[here];
      delete current.restore; write(current);
      let focused = false;
      const restore = () => {
        window.scrollTo({ top: snapshot.top });
        areas().forEach((node, index) => { if (Number.isFinite(snapshot.areas[index])) node.scrollTop = snapshot.areas[index]; });
        const target = snapshot.focusId ? document.getElementById(snapshot.focusId) : Array.from(document.querySelectorAll<HTMLAnchorElement>("main a[href]")).find(link => link.getAttribute("href") === snapshot.focusHref);
        if (!focused && target) { target.focus({ preventScroll: true }); focused = true; }
      };
      const frame = requestAnimationFrame(restore);
      const observer = new MutationObserver(restore);
      observer.observe(document.querySelector("main") ?? document.body, { childList: true, subtree: true });
      const stop = () => { observer.disconnect(); cancelAnimationFrame(frame); };
      const timer = setTimeout(stop, 2000);
      window.addEventListener("pointerdown", stop, { once: true }); window.addEventListener("wheel", stop, { once: true }); window.addEventListener("keydown", stop, { once: true });
      cleanup = () => { stop(); clearTimeout(timer); window.removeEventListener("pointerdown", stop); window.removeEventListener("wheel", stop); window.removeEventListener("keydown", stop); };
    }
    return () => { document.removeEventListener("click", remember, true); window.removeEventListener("popstate", pop); cleanup(); };
  }, [key, pathname, route]);
  return <Context.Provider value={back?.key === key && back.path === pathname ? back.value : null}>{children}</Context.Provider>;
}

export function ContextBackLink({ href, children, className, returnToOrigin = false }: { href: string; children: ReactNode; className?: string; returnToOrigin?: boolean }) {
  const back = useContext(Context);
  const parent = recordParent(usePathname());
  const contextual = (returnToOrigin || parent?.href === href) && back != null;
  return <Link href={contextual ? back.href : href} data-restore-context={contextual ? "true" : undefined} scroll={!contextual} className={className}>{contextual ? `Back to ${back.label}` : children}</Link>;
}
