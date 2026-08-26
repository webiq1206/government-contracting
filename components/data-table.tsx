"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  buildHref,
  nextSort,
  type Density,
  type FilterValues,
  type PageState,
  type SortState,
  PER_PAGE_CHOICES,
} from "@/lib/domain/table-view";

export interface Column<T> {
  key: string;
  header: string;
  /** Sortable columns become header links that rewrite the URL. */
  sortable?: boolean;
  /** Hidden until the operator turns it on. Keeps the default table readable. */
  optional?: boolean;
  /** Right-align numbers so they can be compared down the column. */
  numeric?: boolean;
  render: (row: T) => React.ReactNode;
  /** Longer explanation for the header, shown on hover. */
  hint?: string;
}

/**
 * The table every list page uses.
 *
 * The Sub Database was a nine-column table with no sorting, no pagination and
 * no way to hide a column, rendering every row it was given. At five hundred
 * subcontractors that is a wall: you cannot find the roofers in Texas by
 * looking, and the page has already sent five hundred rows to a phone.
 *
 * Sorting and paging are URL state (see lib/domain/table-view) so a view is a
 * link. Column choice and density are NOT: they are about the person reading,
 * not the data, and a shared link should not impose the sender's column
 * choices on whoever opens it. Those live in this browser instead.
 */
export function DataTable<T extends { id: string }>({
  rows,
  columns,
  pathname,
  filters,
  sort,
  paging,
  total,
  prefsKey,
  rowHref,
  selection,
  emptyState,
}: {
  rows: T[];
  columns: Column<T>[];
  pathname: string;
  filters: FilterValues;
  sort: SortState;
  paging: PageState;
  total: number;
  /** Storage key for column visibility + density on this page. */
  prefsKey: string;
  rowHref?: (row: T) => string;
  selection?: {
    selected: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: (ids: string[]) => void;
    /** The sticky bar shown while anything is selected. */
    bar: (selected: string[]) => React.ReactNode;
  };
  emptyState: React.ReactNode;
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<Density>("comfortable");
  const [menuOpen, setMenuOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(prefsKey);
      if (raw) {
        const p = JSON.parse(raw) as { hidden?: string[]; density?: Density };
        if (p.hidden) setHidden(new Set(p.hidden));
        if (p.density) setDensity(p.density);
      } else {
        // First visit: optional columns start hidden, so the default table is
        // the readable one rather than everything at once.
        setHidden(new Set(columns.filter((c) => c.optional).map((c) => c.key)));
      }
    } catch {
      /* storage disabled: defaults are fine */
    }
    setLoaded(true);
    // Keyed on the page, not the columns: re-running when a column array
    // identity changes would wipe the operator's choices on every render.
  }, [prefsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function persist(nextHidden: Set<string>, nextDensity: Density) {
    setHidden(nextHidden);
    setDensity(nextDensity);
    try {
      window.localStorage.setItem(
        prefsKey,
        JSON.stringify({ hidden: [...nextHidden], density: nextDensity })
      );
    } catch {
      /* ignore */
    }
  }

  const visible = useMemo(
    () => columns.filter((c) => !hidden.has(c.key)),
    [columns, hidden]
  );

  const href = (over: Parameters<typeof buildHref>[1]) =>
    buildHref(pathname, { filters, sort, page: paging.page, perPage: paging.perPage, ...over });

  const pad = density === "compact" ? "px-3 py-1.5" : "px-3 py-3";
  const selectedIds = selection ? [...selection.selected] : [];
  const pageIds = rows.map((r) => r.id);
  const allOnPageSelected =
    selection != null && pageIds.length > 0 && pageIds.every((id) => selection.selected.has(id));

  if (total === 0) return <>{emptyState}</>;

  return (
    <div className="relative">
      {/* Column + density controls. Deliberately above the table's own scroll
          container so they stay reachable on a wide table. */}
      <div className="flex flex-wrap items-center justify-end gap-2 px-1 pb-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            className="btn-ghost h-8 text-xs"
          >
            Columns ({visible.length}/{columns.length})
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-border bg-surface p-2 shadow-lg">
              {columns.map((c) => (
                <label
                  key={c.key}
                  className="flex min-h-9 cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.key)}
                    onChange={() => {
                      const next = new Set(hidden);
                      if (next.has(c.key)) next.delete(c.key);
                      else next.add(c.key);
                      // Never hide the last column: a table with no columns is
                      // an unrecoverable state reached by one stray click.
                      if (next.size >= columns.length) return;
                      persist(next, density);
                    }}
                  />
                  {c.header}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 text-xs">
          <span className="text-muted-foreground">Rows</span>
          {(["comfortable", "compact"] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => persist(hidden, d)}
              /* Thumb-sized where a thumb is what presses it. The sweep
                 measured these at 24px tall on a phone, which clears WCAG
                 2.5.8 and not the 44px this product holds itself to. */
              className={`inline-flex min-h-11 items-center rounded px-3 transition-colors md:min-h-0 md:px-2 md:py-1 ${
                density === d ? "bg-gold/20 text-gold-text" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {d === "comfortable" ? "Roomy" : "Tight"}
            </button>
          ))}
        </div>
      </div>

      <div className="scroll-thin max-h-[calc(100dvh-18rem)] overflow-auto rounded-md border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          {/* Sticky header: on a hundred-row page, scrolling three screens down
              and no longer knowing which column is which is the whole problem
              a table is supposed to solve. */}
          <thead className="sticky top-0 z-10 bg-surface-raised shadow-[0_1px_0_var(--border)]">
            <tr>
              {selection && (
                <th className={`th w-8 ${pad}`}>
                  <input
                    type="checkbox"
                    aria-label="Select every row on this page"
                    checked={allOnPageSelected}
                    onChange={() => selection.onToggleAll(pageIds)}
                  />
                </th>
              )}
              {visible.map((c) => {
                const active = sort.key === c.key;
                const arrow = !active ? "" : sort.direction === "asc" ? " ↑" : " ↓";
                return (
                  <th
                    key={c.key}
                    title={c.hint}
                    className={`th ${pad} ${c.numeric ? "text-right" : "text-left"}`}
                  >
                    {c.sortable ? (
                      <Link
                        href={href({ sort: nextSort(sort, c.key), page: 1 })}
                        /* A sort control, not a word: 13px of link text in a
                           header row is unhittable on a phone, and sorting is
                           exactly what somebody does on a small screen to make
                           a wide table usable. */
                        className={`-mx-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 transition-colors hover:text-foreground md:mx-0 md:min-h-0 md:min-w-0 md:justify-start md:px-0 ${
                          active ? "text-gold-text" : ""
                        }`}
                      >
                        {c.header}
                        {arrow}
                      </Link>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border transition-colors hover:bg-surface">
                {selection && (
                  <td className={`td ${pad}`}>
                    <input
                      type="checkbox"
                      aria-label="Select this row"
                      checked={selection.selected.has(row.id)}
                      onChange={() => selection.onToggle(row.id)}
                    />
                  </td>
                )}
                {visible.map((c) => (
                  <td
                    key={c.key}
                    className={`td ${pad} ${c.numeric ? "text-right tabular-nums" : ""}`}
                  >
                    {c.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  className="td py-10 text-center text-muted-foreground"
                  colSpan={visible.length + (selection ? 1 : 0)}
                >
                  Nothing matches these filters.{" "}
                  <Link href={pathname} className="text-gold-text hover:underline">
                    Clear them
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-3 text-xs text-muted-foreground">
        <span>
          Showing <span className="tabular-nums">{paging.from}</span>-
          <span className="tabular-nums">{paging.to}</span> of{" "}
          <span className="tabular-nums">{total}</span>
        </span>

        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            Per page
            {PER_PAGE_CHOICES.map((n) => (
              <Link
                key={n}
                href={href({ perPage: n, page: 1 })}
                className={`rounded px-1.5 py-0.5 transition-colors ${
                  paging.perPage === n ? "bg-gold/20 text-gold-text" : "hover:text-foreground"
                }`}
              >
                {n}
              </Link>
            ))}
          </span>

          {paging.totalPages > 1 && (
            <span className="flex items-center gap-2">
              {paging.page > 1 ? (
                <Link href={href({ page: paging.page - 1 })} className="hover:text-foreground">
                  ← Prev
                </Link>
              ) : (
                <span className="opacity-40">← Prev</span>
              )}
              <span className="tabular-nums">
                {paging.page} / {paging.totalPages}
              </span>
              {paging.page < paging.totalPages ? (
                <Link href={href({ page: paging.page + 1 })} className="hover:text-foreground">
                  Next →
                </Link>
              ) : (
                <span className="opacity-40">Next →</span>
              )}
            </span>
          )}
        </span>
      </div>

      {/* Bulk bar: sticky at the bottom so a selection made at row 3 is still
          actionable at row 90 without scrolling back. */}
      {selection && selectedIds.length > 0 && (
        <div className="sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center gap-3 border-t border-gold/40 bg-surface-raised px-4 py-3 shadow-[0_-2px_8px_rgba(0,0,0,0.06)]">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.length} selected
          </span>
          <button
            type="button"
            onClick={() => selection.onToggleAll([])}
            className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Clear
          </button>
          <span className="ml-auto flex flex-wrap items-center gap-2">
            {selection.bar(selectedIds)}
          </span>
        </div>
      )}

      {!loaded && <span className="sr-only">Loading table preferences</span>}
    </div>
  );
}
