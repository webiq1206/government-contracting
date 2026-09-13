"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Existing task URLs and fragments still open their exact work section. */
export function TodayDetails({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function revealHash() {
      let id = "";
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      if (!id) return;
      const target = document.getElementById(id);
      if (!target || !ref.current?.contains(target)) return;
      ref.current.open = true;
      for (let node: HTMLElement | null = target; node && node !== ref.current; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement) node.open = true;
      }
      requestAnimationFrame(() => target.scrollIntoView({ block: "start", behavior: "instant" }));
    }
    if (defaultOpen && ref.current) ref.current.open = true;
    revealHash();
    window.addEventListener("hashchange", revealHash);
    return () => window.removeEventListener("hashchange", revealHash);
  }, [defaultOpen]);
  return <details ref={ref} open={defaultOpen || undefined} className="mt-8 border-t border-border/60 pt-4" data-today-details>
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-4 text-sm font-medium text-muted-foreground">All task views and controls<span aria-hidden>⌄</span></summary>
    <div className="pt-4">{children}</div>
  </details>;
}
