"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

/** Compact native disclosure that releases the record list after selection. */
export function PipelineViewMenu({ view }: { view: string }) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (details.current && !details.current.contains(event.target as Node)) details.current.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return <details ref={details} className="relative sm:hidden" onKeyDown={(event) => {
    if (event.key === "Escape" && details.current?.open) {
      event.preventDefault(); details.current.open = false;
      details.current.querySelector("summary")?.focus();
    }
  }}>
    <summary className="btn-secondary min-h-11 cursor-pointer list-none [&::-webkit-details-marker]:hidden">View</summary>
    <div className="absolute right-0 top-12 z-30 grid min-w-40 gap-1 rounded-lg border border-border bg-background p-2 shadow-xl">
      {[["lanes", "Simple"], ["list", "List"], ["stages", "All stages"], ["table", "Table"]].map(([value, label]) =>
        <Link key={value} href={`/pipeline?view=${value}`} aria-current={view === value ? "page" : undefined}
          onClick={() => { if (details.current) details.current.open = false; }}
          className="min-h-11 rounded-md px-3 py-2 text-sm text-foreground hover:bg-muted">{label}</Link>)}
    </div>
  </details>;
}
