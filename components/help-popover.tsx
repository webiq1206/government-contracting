"use client";

/**
 * The small "?" next to each page title. Opens a compact popover with a few
 * bullets: what this page is for, what to do here, and what runs on its own.
 * Deliberately short, the full journey lives at /how-it-works.
 */

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export interface HelpContent {
  title: string;
  points: string[];
}

export function HelpPopover({
  help,
  variant: _variant = "light",
}: {
  help: HelpContent;
  /** @deprecated Theme tokens cover both surfaces; kept for call-site compatibility. */
  variant?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function place() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setAlignRight(rect.left + 320 > window.innerWidth - 16);
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
    <div className="relative inline-block shrink-0" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={open ? "Hide page help" : "What is this page?"}
        aria-expanded={open}
        aria-controls={panelId}
        title="What is this page?"
        onClick={() => setOpen((o) => !o)}
        className={`tap h-8 w-8 shrink-0 rounded-full border text-xs font-semibold transition-colors lg:h-6 lg:w-6 ${
          open
            ? "border-accent bg-gold text-ink"
            : "border-foreground/50 text-muted-foreground hover:border-accent hover:text-gold-text"
        }`}
      >
        ?
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={titleId}
          className={`fixed inset-x-4 top-[4.25rem] z-[70] max-h-[calc(100dvh-8.25rem-env(safe-area-inset-bottom))] w-auto overflow-y-auto rounded-md border border-border bg-background p-4 shadow-xl lg:absolute lg:inset-x-auto lg:top-8 lg:max-h-none lg:w-80 lg:overflow-visible ${
            alignRight ? "lg:right-0" : "lg:left-0"
          }`}
        >
          <p id={titleId} className="text-sm font-semibold text-foreground">
            {help.title}
          </p>
          <ul className="mt-2 space-y-1.5">
            {help.points.map((p, i) => (
              <li key={i} className="flex gap-2 text-sm leading-snug text-slate-600">
                <span className="mt-0.5 text-accent">·</span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/how-it-works"
            className="mt-3 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline"
            onClick={() => setOpen(false)}
          >
            See how the whole process works →
          </Link>
        </div>
      )}
    </div>
  );
}
