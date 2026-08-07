"use client";

/**
 * Global search, opened with ⌘K / Ctrl+K or the nav's Search button. Finds
 * opportunities, subcontractors, and contracts by name and jumps straight to
 * the record, killing the "scroll the pipeline hoping to spot it" hunt.
 * Keyboard first: arrows move, Enter opens, Esc closes.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface Result {
  kind: "opportunity" | "subcontractor" | "contract";
  title: string;
  subtitle: string;
  href: string;
}

const KIND_LABEL: Record<Result["kind"], string> = {
  opportunity: "Opportunity",
  subcontractor: "Subcontractor",
  contract: "Contract",
};

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open on ⌘K / Ctrl+K anywhere in the app; the nav Search button dispatches
  // the same custom event so there's a discoverable, clickable entry point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("open-command-palette", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("open-command-palette", onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQ("");
      setResults([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const data = (await res.json()) as { results: Result[] };
          setResults(data.results);
          setActive(0);
        }
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q, open]);

  const go = useCallback(
    (r: Result) => {
      setOpen(false);
      router.push(r.href);
    },
    [router]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-start justify-center bg-black/40 p-4 pt-[12vh]"
      onClick={() => setOpen(false)}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            else if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, results.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter" && results[active]) {
              go(results[active]);
            }
          }}
          placeholder="Search opportunities, subcontractors, contracts…"
          className="w-full border-b border-border bg-background px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-slate-500"
        />
        <div className="scroll-thin max-h-[50vh] overflow-y-auto">
          {q.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500">
              Nothing matches &ldquo;{q.trim()}&rdquo;. Try part of a title,
              solicitation number, agency, or company name.
            </p>
          )}
          {q.trim().length < 2 && (
            <p className="px-4 py-6 text-center text-xs text-slate-500">
              Type at least 2 characters. Tip: open this anywhere with ⌘K.
            </p>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.href}-${i}`}
              onClick={() => go(r)}
              onMouseEnter={() => setActive(i)}
              className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${
                i === active ? "bg-accent-soft" : ""
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-900">{r.title}</span>
                {r.subtitle && (
                  <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>
                )}
              </span>
              <span className="badge shrink-0 bg-slate-200 text-slate-600">
                {KIND_LABEL[r.kind]}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The nav's clickable entry point; opens the same palette. */
export function SearchButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className={className}
      title="Search everything (⌘K)"
    >
      <span aria-hidden>⌕</span> Search
      <kbd className="ml-auto hidden rounded border border-border px-1 text-[10px] text-slate-500 md:inline">
        ⌘K
      </kbd>
    </button>
  );
}
