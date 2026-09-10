"use client";

/**
 * Global search, opened with ⌘K / Ctrl+K or the nav's Search button.
 *
 * Finds opportunities, subcontractors, contracts, messages and documents and
 * jumps straight to the record, killing the "scroll the pipeline hoping to
 * spot it" hunt. Keyboard first: arrows move, Enter opens, Esc closes.
 *
 * Results are grouped rather than listed flat with a badge each, because a
 * badge makes the reader do the sorting: they scan nineteen rows looking for
 * the one subcontractor among the opportunities. The per-group counts are also
 * what tell somebody their search matched four messages they had not thought
 * to look in.
 */

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useKeyboardViewport } from "./use-keyboard-viewport";
import {
  groupResults,
  highlight,
  noResultAdvice,
  KIND_LABEL,
  type SearchResult as Result,
} from "@/lib/domain/search-results";

/** Remembered between visits, so the same lookup is not retyped every morning. */
const RECENT_KEY = "brostco.search.recent";
const RECENT_MAX = 5;

function scopedKey(key: string, storageScope: string): string {
  return `${key}.${storageScope}`;
}

function readRecent(storageScope: string): string[] {
  try {
    const raw = window.localStorage.getItem(scopedKey(RECENT_KEY, storageScope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    // A private window, blocked storage, or a value somebody hand-edited. A
    // remembered search is a convenience, so failing to read one is not worth
    // breaking search over.
    return [];
  }
}

/**
 * The records somebody actually opened, remembered per browser.
 *
 * A recent SEARCH is the words you typed; a recent RECORD is the thing you
 * were working on. They answer different questions, and the second is the one
 * somebody wants at nine in the morning: back to the opportunity they left
 * half-priced last night, without remembering what it was called.
 *
 * Stored in this browser only and keyed by organization. A shared machine can
 * remember each account's shortcuts without showing one tenant's record names
 * after somebody signs in to another tenant.
 */
const RECENT_RECORD_KEY = "brostco.search.records";
const RECENT_RECORD_MAX = 5;

export interface RecentRecord {
  kind: Result["kind"];
  title: string;
  href: string;
}

function readRecentRecords(storageScope: string): RecentRecord[] {
  try {
    const raw = window.localStorage.getItem(scopedKey(RECENT_RECORD_KEY, storageScope));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is RecentRecord =>
        !!x &&
        typeof x === "object" &&
        typeof (x as RecentRecord).href === "string" &&
        typeof (x as RecentRecord).title === "string"
    );
  } catch {
    return [];
  }
}

function rememberRecord(r: Result, storageScope: string) {
  try {
    const next = [
      { kind: r.kind, title: r.title, href: r.href },
      ...readRecentRecords(storageScope).filter((x) => x.href !== r.href),
    ].slice(0, RECENT_RECORD_MAX);
    window.localStorage.setItem(
      scopedKey(RECENT_RECORD_KEY, storageScope),
      JSON.stringify(next)
    );
  } catch {
    /* see readRecent */
  }
}

function rememberSearch(q: string, storageScope: string) {
  const trimmed = q.trim();
  if (trimmed.length < 2) return;
  try {
    const next = [
      trimmed,
      ...readRecent(storageScope).filter((r) => r !== trimmed),
    ].slice(0, RECENT_MAX);
    window.localStorage.setItem(scopedKey(RECENT_KEY, storageScope), JSON.stringify(next));
  } catch {
    /* see readRecent */
  }
}

export function CommandPalette({ storageScope }: { storageScope: string }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keyboard = useKeyboardViewport();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [recentRecords, setRecentRecords] = useState<RecentRecord[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestRef = useRef(0);
  const titleId = useId();
  const resultsId = useId();
  const groups = useMemo(() => groupResults(results), [results]);
  /*
   * One flat index across the groups, so the arrow keys still walk every row
   * in the order they are drawn. Grouping is a rendering decision and must not
   * change what Enter opens.
   */
  const flat = useMemo(() => groups.flatMap((g) => g.results), [groups]);

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
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    dialog?.showModal();
    setQ("");
    setResults([]);
    setActive(0);
    setSearchError(null);
    setRecent(readRecent(storageScope));
    setRecentRecords(readRecentRecords(storageScope));
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      dialog?.close();
      window.clearTimeout(timer);
      openerRef.current?.focus?.();
    };
  }, [open, storageScope]);

  // Debounced search.
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) {
      requestRef.current += 1;
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    const request = requestRef.current + 1;
    requestRef.current = request;
    const controller = new AbortController();
    const deadline = setTimeout(() => {
      controller.abort();
      if (request === requestRef.current) {
        setSearchError("Search took too long. Check your connection and try again.");
        setSearching(false);
      }
    }, 20_000);
    setSearching(true);
    setSearchError(null);
    setResults([]);
    setActive(0);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = (await res.json().catch(() => ({}))) as {
          results?: Result[];
          error?: string;
        };
        if (request !== requestRef.current) return;
        if (!res.ok) {
          setResults([]);
          setSearchError(
            data.error ??
              "Search could not load. Your records are unchanged. Check the connection and try again."
          );
          return;
        }
        setResults(Array.isArray(data.results) ? data.results : []);
        setActive(0);
      } catch {
        if (controller.signal.aborted || request !== requestRef.current) return;
        setResults([]);
        setSearchError(
          "Search could not reach the server. Your records are unchanged. Check the connection and try again."
        );
      } finally {
        clearTimeout(deadline);
        if (request === requestRef.current) setSearching(false);
      }
    }, 250);
    return () => {
      clearTimeout(t);
      clearTimeout(deadline);
      controller.abort();
    };
  }, [q, open, searchAttempt]);

  const go = useCallback(
    (r: Result, query: string) => {
      rememberSearch(query, storageScope);
      // What they opened, as well as what they typed. Next time the box is
      // empty, this is what it offers.
      rememberRecord(r, storageScope);
      setOpen(false);
      router.push(r.href);
    },
    [router, storageScope]
  );

  const onDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
        ) ?? []
      ).filter((item) => item.getClientRects().length > 0);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    []
  );

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      style={keyboard ? { top: keyboard.top, height: keyboard.height, paddingTop: 8, bottom: "auto" } : undefined}
      className="fixed inset-0 z-[90] m-0 flex h-full max-h-none w-full max-w-none items-start justify-center border-0 bg-transparent p-4 pt-[8dvh] text-foreground backdrop:bg-black/55"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={panelRef}
        onKeyDown={onDialogKeyDown}
        className="flex max-h-full min-h-0 w-full max-w-lg flex-col overflow-hidden rounded-md border border-foreground/50 bg-surface text-foreground shadow-2xl dark:border-white/35"
      >
        <h2 id={titleId} className="sr-only">
          Search everything
        </h2>
        <div className="flex border-b border-foreground/50 dark:border-white/35">
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                if (flat[active]) go(flat[active], q);
                else if (q.trim().length >= 2 && !searchError) {
                  // Nothing highlighted, so Enter means "show me everything".
                  rememberSearch(q, storageScope);
                  setOpen(false);
                  router.push(`/search?q=${encodeURIComponent(q.trim())}`);
                }
              }
            }}
            aria-label="Search opportunities, subcontractors, contracts, messages, and documents"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={resultsId}
            aria-activedescendant={flat[active] ? `${resultsId}-option-${active}` : undefined}
            placeholder="Search opportunities, subs, contracts, messages, documents…"
            className="min-h-11 min-w-0 flex-1 bg-background px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-slate-500 coarse:text-base"
          />
          <button
            type="button"
            className="tap min-h-11 min-w-11 border-l border-foreground/50 px-3 text-sm text-muted-foreground hover:text-foreground dark:border-white/35"
            aria-label="Close search"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden>x</span>
          </button>
        </div>
        {/* A result count, and where to see the rest. */}
        {flat.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-1.5 text-xs text-slate-500">
            <span>
              {flat.length} result{flat.length === 1 ? "" : "s"}
              {searching ? ", still looking" : ""}
            </span>
            <button
              type="button"
              className="inline-flex min-h-11 items-center font-medium text-accent hover:underline"
              onClick={() => {
                rememberSearch(q, storageScope);
                setOpen(false);
                router.push(`/search?q=${encodeURIComponent(q.trim())}`);
              }}
            >
              View all results
            </button>
          </div>
        )}
        <div
          id={resultsId}
          role={flat.length > 0 ? "listbox" : undefined}
          aria-label={flat.length > 0 ? "Search results" : undefined}
          aria-busy={searching}
          className="scroll-thin max-h-[50vh] overflow-y-auto"
        >
          {/*
            * The loading state. It was computed and never rendered, so a slow
            * search showed an empty box: indistinguishable from no matches,
            * which is the wrong conclusion to invite.
            */}
          {searching && flat.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-slate-500" role="status">
              Searching…
            </p>
          )}
          {searchError && !searching && (
            <div className="px-4 py-5 text-sm" role="alert">
              <p className="font-medium text-risk">Search did not load</p>
              <p className="mt-1 text-xs text-muted-foreground">{searchError}</p>
              <button
                type="button"
                className="btn-ghost mt-3 text-xs"
                onClick={() => setSearchAttempt((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          {q.trim().length >= 2 && !searching && !searchError && flat.length === 0 && (
            <div className="px-4 py-5 text-sm text-slate-600">
              <p className="text-slate-900">Nothing matches &ldquo;{q.trim()}&rdquo;.</p>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-500">
                {noResultAdvice(q).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {q.trim().length < 2 && (
            <div className="px-4 py-5">
              {recentRecords.length > 0 && (
                <div className="mb-4">
                  <p className="label mb-1.5">Back to what you were on</p>
                  <ul className="space-y-1">
                    {recentRecords.map((r) => (
                      <li key={r.href}>
                        <button
                          type="button"
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-foreground/50 px-3 py-2 text-left hover:border-accent/50 dark:border-white/35"
                          onClick={() => {
                            setOpen(false);
                            router.push(r.href);
                          }}
                        >
                          <span className="min-w-0 truncate text-sm text-foreground">
                            {r.title}
                          </span>
                          <span className="badge shrink-0 border border-border bg-surface text-slate-600">
                            {KIND_LABEL[r.kind]}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500">
                    Remembered by this browser only, never sent anywhere.
                  </p>
                </div>
              )}
              {recent.length > 0 ? (
                <>
                  <p className="label mb-1.5">Recent searches</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recent.map((r) => (
                      <button
                        key={r}
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-full border border-foreground/50 bg-surface px-3 py-1 text-xs text-slate-600 hover:border-accent/50 dark:border-white/35"
                        onClick={() => setQ(r)}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    Type at least 2 characters. Open this anywhere with ⌘K.
                  </p>
                </>
              ) : recentRecords.length === 0 ? (
                <p className="text-center text-xs text-slate-500">
                  Type at least 2 characters. Tip: open this anywhere with ⌘K.
                </p>
              ) : null}
            </div>
          )}
          {groups.map((group) => (
            <div key={group.kind} role="group" aria-label={group.label}>
              <p className="sticky top-0 bg-surface px-4 pb-1 pt-2.5 text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">
                {group.label}
                <span className="num ml-1.5">{group.results.length}</span>
              </p>
              {group.results.map((r) => {
                const i = flat.indexOf(r);
                return (
                  <button
                    key={`${r.kind}-${r.href}-${i}`}
                    id={`${resultsId}-option-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onClick={() => go(r, q)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${
                      i === active ? "bg-gold/10" : ""
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-slate-900">
                        <Marked text={r.title} query={q} />
                      </span>
                      {r.subtitle && (
                        <span className="block truncate text-xs text-slate-500">
                          <Marked text={r.subtitle} query={q} />
                        </span>
                      )}
                    </span>
                    <span className="badge shrink-0 border border-border bg-surface text-slate-600">
                      {KIND_LABEL[r.kind]}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </dialog>
  );
}

/**
 * The matched part of a result, marked.
 *
 * Segments rather than dangerouslySetInnerHTML: the text is a customer's own
 * record, and this is the one component every record in the account passes
 * through on its way to the screen.
 */
export function Marked({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((seg, i) =>
        seg.match ? (
          <mark key={i} className="bg-gold/30 text-inherit">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

/** The nav's clickable entry point; opens the same palette. */
export function SearchButton({
  className = "",
  iconOnly = false,
}: {
  className?: string;
  /** Icon-only control for the phone app bar, where the word "Search" does not fit. */
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
      className={className}
      aria-label="Search everything"
      title="Search everything (⌘K)"
    >
      <span aria-hidden>⌕</span>
      {!iconOnly && (
        <>
          {" "}
          Search
          <kbd className="ml-auto hidden rounded border border-current/25 px-1 text-[10px] opacity-60 lg:inline">
            ⌘K
          </kbd>
        </>
      )}
    </button>
  );
}
