"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/** A side column on desktop, a focused modal sheet on touch-sized layouts. */
export function DetailDrawerFrame({ children, closeHref, navigate, documentNavigation = false }: { documentNavigation?: boolean; children: ReactNode; closeHref: string; navigate?: (href: string) => void }) {
  const panel = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const close = () => navigate ? navigate(closeHref) : documentNavigation ? window.location.assign(closeHref) : router.push(closeHref, { scroll: false });
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
    const dialog = panel.current;
    if (!dialog) return;
    // Native modal isolation does not mutate attributes on streamed siblings.
    // A nonmodal open dialog remains a regular side column on desktop.
    if (modal) {
      if (dialog.open) dialog.close();
      dialog.showModal();
    } else if (!dialog.open) dialog.show();
    return () => { if (dialog.open) dialog.close(); };
  }, [modal]);
  return <dialog open ref={panel} tabIndex={-1} role={modal ? "dialog" : "complementary"}
    onCancel={event => { event.preventDefault(); close(); }}
    aria-modal={modal || undefined} aria-label="Record details"
    onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (!modal || event.key !== "Tab") return;
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>("a[href]:not([aria-disabled='true']),button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex='0']") ?? []).filter(node => node.getClientRects().length > 0);
      if (!items.length) { event.preventDefault(); panel.current?.focus(); return; }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }}
    className="fixed inset-0 z-[65] m-0 flex h-full w-full max-h-none max-w-none flex-col overflow-hidden border-0 border-border/55 bg-background p-0 text-foreground backdrop:bg-black/40 lg:static lg:inset-auto lg:h-auto lg:z-auto lg:w-[340px] lg:shrink-0 lg:border-l dark:border-white/10">
    {children}
  </dialog>;
}
