"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  activeChips,
  buildHref,
  withoutFilter,
  isSameView,
  type FilterSpec,
  type FilterValues,
  type SavedView,
} from "@/lib/domain/table-view";

/**
 * The filter bar every list page uses.
 *
 * Three things it does that the hand-rolled versions did not:
 *
 * 1. It shows what is currently filtered, as removable chips. "Why is this
 *    list empty" is almost always a control three fields to the right that
 *    nobody remembers setting, and the answer should not require reading the
 *    URL.
 * 2. It applies on change rather than behind an Apply button. The old bar made
 *    you fill in four fields and then press a fifth thing, and a filter you
 *    forgot to apply is a list that silently disagrees with its own controls.
 *    Text still commits on Enter or blur, because narrowing on every keystroke
 *    is its own kind of unusable.
 * 3. It saves views. A view is a named query string -- nothing more -- so a
 *    saved view can only ever be something this page can already render.
 *
 * Saved views live in this browser. They are one person's shortcuts, not
 * shared configuration, and putting them on the server would mean one
 * operator's "Due this week" quietly appearing in a colleague's toolbar.
 */
export function FilterToolbar({
  pathname,
  specs,
  values,
  sortParam,
  perPage,
  /** Storage key for this page's saved views. */
  viewsKey,
  /** Rendered on the right: the page's single primary action. */
  action,
  resultLabel,
}: {
  pathname: string;
  specs: FilterSpec[];
  values: FilterValues;
  sortParam?: string;
  perPage?: number;
  viewsKey: string;
  action?: React.ReactNode;
  /** e.g. "Showing 1-50 of 312". Sits with the filters it describes. */
  resultLabel?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<FilterValues>(values);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  // The URL is the truth; if it changes underneath (Back, a chip removed, a
  // saved view opened) the controls follow it rather than the other way round.
  useEffect(() => setDraft(values), [values]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(viewsKey);
      if (raw) setViews(JSON.parse(raw) as SavedView[]);
    } catch {
      // A browser with storage disabled loses saved views, not the page.
    }
  }, [viewsKey]);

  function persist(next: SavedView[]) {
    setViews(next);
    try {
      window.localStorage.setItem(viewsKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function go(nextFilters: FilterValues) {
    // Any filter change returns to page 1. Staying on page 7 of a list that
    // now has two pages is the "empty table that looks like no results"
    // failure, arrived at from the other direction.
    router.push(
      buildHref(pathname, {
        filters: nextFilters,
        sort: sortParam ? parseSortParam(sortParam) : undefined,
        perPage,
      })
    );
  }

  function set(key: string, value: string) {
    const next = { ...draft };
    if (value.trim()) next[key] = value;
    else delete next[key];
    setDraft(next);
    return next;
  }

  const chips = useMemo(() => activeChips(specs, values), [specs, values]);
  const currentQuery = useMemo(
    () => buildHref(pathname, { filters: values, perPage }).split("?")[1] ?? "",
    [pathname, values, perPage]
  );
  const activeView = views.find((v) => isSameView(v.query, currentQuery));

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-end gap-3">
          {specs.map((spec) => (
            <Control
              key={spec.key}
              spec={spec}
              value={draft[spec.key] ?? ""}
              onChange={(v) => set(spec.key, v)}
              onCommit={(v) => go(set(spec.key, v))}
            />
          ))}
          {action && <div className="ml-auto flex items-end">{action}</div>}
        </div>

        {(chips.length > 0 || views.length > 0 || resultLabel) && (
          <div className="flex flex-wrap items-center gap-2">
            {resultLabel && (
              <span className="text-xs text-muted-foreground">{resultLabel}</span>
            )}

            {chips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => go(withoutFilter(values, c.key))}
                className="badge inline-flex items-center gap-1.5 bg-gold/15 text-gold-text transition-colors hover:bg-gold/25"
                title={`Remove the ${c.label} filter`}
              >
                <span className="font-medium">{c.label}:</span> {c.display}
                <span aria-hidden>×</span>
                <span className="sr-only">Remove filter</span>
              </button>
            ))}

            {chips.length > 0 && (
              <button
                type="button"
                onClick={() => go({})}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            )}

            {chips.length > 0 && !activeView && (
              naming ? (
                <span className="inline-flex items-center gap-1">
                  <input
                    autoFocus
                    className="input h-7 w-40 text-xs"
                    placeholder="Name this view"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setNaming(false);
                      if (e.key === "Enter" && name.trim()) {
                        persist([
                          ...views,
                          { id: `${Date.now()}`, name: name.trim(), query: currentQuery },
                        ]);
                        setName("");
                        setNaming(false);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setNaming(false)}
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setNaming(true)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  Save this view
                </button>
              )
            )}

            {views.length > 0 && (
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
                  Saved
                </span>
                {views.map((v) => (
                  <span key={v.id} className="inline-flex items-center">
                    <button
                      type="button"
                      onClick={() => router.push(v.query ? `${pathname}?${v.query}` : pathname)}
                      className={`badge transition-colors ${
                        activeView?.id === v.id
                          ? "bg-gold text-ink"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {v.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete the ${v.name} view`}
                      title={`Delete the ${v.name} view`}
                      onClick={() => persist(views.filter((x) => x.id !== v.id))}
                      className="px-1 text-xs text-muted-foreground hover:text-risk"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** `sort=-name` back into the shape buildHref wants. */
function parseSortParam(raw: string) {
  const desc = raw.startsWith("-");
  return { key: desc ? raw.slice(1) : raw, direction: desc ? ("desc" as const) : ("asc" as const) };
}

function Control({
  spec,
  value,
  onChange,
  onCommit,
}: {
  spec: FilterSpec;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
}) {
  const id = `filter-${spec.key}`;

  if (spec.kind === "boolean") {
    return (
      <label
        htmlFor={id}
        title={spec.hint}
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground md:min-h-0"
      >
        <input
          id={id}
          type="checkbox"
          checked={value === "1"}
          onChange={(e) => onCommit(e.target.checked ? "1" : "")}
        />
        {spec.label}
      </label>
    );
  }

  if (spec.kind === "select") {
    return (
      <div className="min-w-0">
        <label className="label mb-1 block" htmlFor={id} title={spec.hint}>
          {spec.label}
        </label>
        <select
          id={id}
          className="input h-9 w-44"
          value={value}
          onChange={(e) => onCommit(e.target.value)}
        >
          <option value="">{spec.placeholder ?? "Any"}</option>
          {spec.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <label className="label mb-1 block" htmlFor={id} title={spec.hint}>
        {spec.label}
      </label>
      <input
        id={id}
        className={`input h-9 ${spec.kind === "min" ? "w-24" : "w-48"}`}
        type={spec.kind === "min" ? "number" : "text"}
        min={spec.min}
        max={spec.max}
        placeholder={spec.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Committing on every keystroke would re-query the server per letter;
        // committing only on a button means a filter you forgot to press.
        onBlur={(e) => onCommit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit((e.target as HTMLInputElement).value);
        }}
      />
    </div>
  );
}
