"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * A section that is a plain, always-open card on desktop and a tap-to-expand
 * accordion on mobile.
 *
 * This used to be a pure-CSS trick (`<details>` with `display:block` forced on
 * the body at the `lg` breakpoint). That broke in modern Chrome, which renders
 * `<details>` content through a `::details-content` pseudo-element that a plain
 * `display` override no longer reveals — so on desktop every section showed only
 * its header and the body stayed collapsed (and hidden from screen readers and
 * text extraction). Switching on a matched media query fixes it reliably: the
 * server and first client render assume desktop (expanded, accessible), and on a
 * narrow viewport it becomes a real, semantic `<details>` accordion after mount.
 */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  children,
}: {
  title: string;
  meta?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  // SSR + first paint assume desktop so the content is always present (no
  // hydration mismatch, and no-JS / crawlers get the full content).
  const [isMobile, setIsMobile] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const header = (
    <>
      <span className="eyebrow">{title}</span>
      {meta != null && <span className="text-xs font-normal text-slate-500">{meta}</span>}
    </>
  );

  if (!isMobile) {
    // Desktop: a normal card with the section always visible.
    return (
      <div className="card">
        <div className="mb-3 flex items-center justify-between gap-2">{header}</div>
        {children}
      </div>
    );
  }

  // Mobile: a native, semantic accordion (collapsed unless defaultOpen).
  return (
    <details
      className="acc"
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{header}</summary>
      <div className="acc-body">{children}</div>
    </details>
  );
}
