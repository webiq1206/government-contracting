"use client";

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
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onClick(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
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
        aria-label={open ? "Hide page help" : "Page help"}
        aria-expanded={open}
        aria-controls={panelId}
        title="Page help"
        onClick={() => setOpen((value) => !value)}
        className={`tap inline-flex min-h-8 items-center px-1 text-xs font-medium transition-colors ${
          open ? "text-accent" : "text-muted-foreground hover:text-accent"
        }`}
      >
        Help
      </button>

      {open && (
        <div
          id={panelId}
          role="region"
          aria-labelledby={titleId}
          className={`fixed inset-x-4 top-16 z-[70] max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom))] w-auto overflow-y-auto overscroll-contain rounded-lg border border-border bg-background p-4 shadow-xl lg:absolute lg:inset-x-auto lg:top-8 lg:max-h-none lg:w-80 lg:overflow-visible ${
            alignRight ? "lg:right-0" : "lg:left-0"
          }`}
        >
          <p id={titleId} className="text-sm font-semibold text-foreground">
            {help.title}
          </p>
          <ul className="mt-2 space-y-1.5">
            {help.points.map((point, index) => (
              <li key={index} className="flex gap-2 text-sm leading-snug text-muted-foreground">
                <span className="mt-0.5 text-accent">·</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <Link
            href="/how-it-works"
            className="mt-3 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline"
            onClick={() => setOpen(false)}
          >
            Help center
          </Link>
        </div>
      )}
    </div>
  );
}
