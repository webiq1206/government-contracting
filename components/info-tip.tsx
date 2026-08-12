"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Compact "?" tip for dense panels (score rows, status badges). Click/tap to
 * open; Esc or outside click closes. Prefer this over native `title=` when the
 * explanation matters for scanning — titles are slow and easy to miss.
 */
export function InfoTip({
  label,
  children,
  side = "top",
}: {
  /** Accessible name for the trigger button. */
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-semibold leading-none transition-colors sm:h-4 sm:w-4 ${
          open
            ? "border-gold bg-gold text-ink"
            : "border-border-strong/50 text-muted-foreground hover:border-gold hover:text-gold"
        }`}
      >
        ?
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={`absolute z-40 w-64 rounded-md border border-border/55 bg-surface p-3 text-left text-xs leading-relaxed text-foreground shadow-lg dark:border-white/10 ${
            side === "bottom" ? "left-0 top-10 sm:top-6" : "bottom-10 left-0 sm:bottom-6"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
