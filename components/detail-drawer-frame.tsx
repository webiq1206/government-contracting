"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** A side column on desktop, a focused modal sheet on touch-sized layouts. */
export function DetailDrawerFrame({ children, closeHref }: { children: ReactNode; closeHref: string }) {
  const panel = useRef<HTMLElement>(null);
  const router = useRouter();
  const [modal, setModal] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    const update = () => setModal(media.matches);
    update();
    media.addEventListener("change", update);
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>("[aria-label='Close details']")?.focus({ preventScroll: true });
    return () => {
      media.removeEventListener("change", update);
      queueMicrotask(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    };
  }, []);
  useEffect(() => {
    if (!modal || !panel.current) return;
    const background: { node: HTMLElement; inert: boolean }[] = [];
    let branch: HTMLElement = panel.current;
    while (branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ node: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    return () => { background.forEach(({ node, inert }) => { node.inert = inert; }); };
  }, [modal]);
  return <aside ref={panel} tabIndex={-1} role={modal ? "dialog" : "complementary"}
    aria-modal={modal || undefined} aria-label="Record details"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); router.push(closeHref, { scroll: false }); }
      if (!modal || event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("a[href]:not([aria-disabled='true']),button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex='0']") ?? []).filter(node => node.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); panel.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }}
    className="fixed inset-0 z-[65] flex flex-col overflow-hidden border-border/55 bg-background lg:static lg:inset-auto lg:z-auto lg:w-[340px] lg:shrink-0 lg:border-l dark:border-white/10">
    {children}
  </aside>;
}
