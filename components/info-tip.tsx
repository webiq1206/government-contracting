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
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAlignRight(rect.left + 256 > window.innerWidth - 16);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    place();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  return (
    <span className="relative inline-flex" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={tipId}
        aria-describedby={open ? tipId : undefined}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className={`tap inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-semibold leading-none transition-colors lg:h-4 lg:w-4 ${
          open
            ? "border-accent bg-gold text-on-accent"
            : "border-foreground/50 text-muted-foreground hover:border-accent hover:text-gold-text"
        }`}
      >
        ?
      </button>
      {open && (
        <span
          id={tipId}
          role="tooltip"
          className={`fixed inset-x-4 top-[4.25rem] z-[70] max-h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom))] w-auto overflow-y-auto rounded-md border border-border/55 bg-surface p-3 text-left text-xs leading-relaxed text-foreground shadow-lg dark:border-white/10 lg:absolute lg:inset-x-auto lg:max-h-none lg:w-64 lg:overflow-visible ${
            side === "bottom" ? "lg:top-6" : "lg:bottom-6 lg:top-auto"
          } ${
            alignRight ? "lg:right-0" : "lg:left-0"
          }`}
        >
          {children}
        </span>
      )}
    </span>
  );
}
