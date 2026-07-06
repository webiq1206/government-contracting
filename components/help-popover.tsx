"use client";

/**
 * The small "?" next to each page title. Opens a compact popover with a few
 * bullets: what this page is for, what to do here, and what runs on its own.
 * Deliberately short — the full journey lives at /how-it-works.
 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export interface HelpContent {
  title: string;
  points: string[];
}

export function HelpPopover({ help }: { help: HelpContent }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label={open ? "Hide page help" : "What is this page?"}
        aria-expanded={open}
        title="What is this page?"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-6 w-6 items-center justify-center rounded-full border text-xs font-semibold transition-colors ${
          open
            ? "border-accent bg-accent text-white"
            : "border-border-strong text-slate-500 hover:border-accent hover:text-accent"
        }`}
      >
        ?
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-40 w-80 rounded-md border border-border bg-background p-4 shadow-xl">
          <p className="text-sm font-semibold text-foreground">{help.title}</p>
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
            className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
            onClick={() => setOpen(false)}
          >
            See how the whole process works →
          </Link>
        </div>
      )}
    </div>
  );
}
