"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import {
  activeChips,
  buildHref,
  clearedFilters,
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
 *
 * On a phone the same controls become a full-screen sheet behind one button.
 * Inline they do not fit: Opportunities has thirteen filters, and a sticky bar
 * holding thirteen labelled fields on a 390px screen is the entire viewport,
 * with the list it filters somewhere below the fold. The sheet is the one
 * place in this bar that keeps an Apply button, because a control that
 * navigates on change would tear down the sheet on the first field touched.
 *
 * It also remembers the LAST view without being asked to. The filters lived
 * only in the URL, so an operator who narrowed the list to the three agencies
 * they work with, opened a record, and came back through the sidebar was
 * handed everything again and had to set all of it a second time. Restoring is
 * never silent: the chips show what is filtered, and a restored view says so
 * with the way out beside it.
 */
export function FilterToolbar({
  pathname,
  specs,
  values,
  sortParam,
  perPage,
  /** Storage key for this page's saved views. */
  viewsKey,
  /**
   * Whether this bar remembers the last view itself.
   *
   * False on a page whose state is larger than the filters, where the page
   * mounts RememberedView instead. Two things restoring the same URL on
   * arrival would fight over it.
   */
  remember = true,
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
  remember?: boolean;
  action?: React.ReactNode;
  /** e.g. "Showing 1-50 of 312". Sits with the filters it describes. */
  resultLabel?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const [draft, setDraft] = useState<FilterValues>(values);
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [viewError, setViewError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetTrigger = useRef<HTMLButtonElement>(null);
  /*
   * Where the last view is kept, beside the saved ones. Separate key: a saved
   * view is something a person named and expects to find again, and the last
   * view is something they simply left behind.
   */
  const lastKey = `${viewsKey}.last`;
  const restoredKey = `${viewsKey}.restored`;
  const [restored, setRestored] = useState(false);
  const checkedMemory = useRef(false);
  /*
   * The query this bar itself put back, so the write below can tell "the view
   * changed because somebody changed it" from "the view changed because we
   * restored it". Without the distinction the notice appeared and vanished in
   * the same frame, which is worse than never showing it.
   */
  const restoredQuery = useRef<string | null>(null);

  // The URL is the truth; if it changes underneath (Back, a chip removed, a
  // saved view opened) the controls follow it rather than the other way round.
  useEffect(() => setDraft(values), [values]);

  /*
   * Views come from the server now, not from this browser.
   *
   * They lived in localStorage, which was right for one of the two kinds and
   * wrong for the other. A personal view is somebody's own shortcut; a team
   * view is how an office agrees what "the work" means this month, and it is
   * useless if it exists only in the browser of the person who made it.
   * Storing personal ones server-side too costs nothing and stops a device
   * change losing them, which is the failure that made saved views feel
   * unreliable and stopped anybody making one.
   *
   * What stays local is the last view somebody left, below: a per-device
   * convenience rather than a thing anybody named.
   */
  const loadViews = useCallback(async () => {
    try {
      const res = await fetch(`/api/views?page=${encodeURIComponent(viewsKey)}`);
      if (!res.ok) return;
      const data = (await res.json()) as { views?: SavedView[] };
      setViews(data.views ?? []);
    } catch {
      // A failed read leaves the bar without its saved views and with
      // everything else working, which is the right half to lose.
    }
  }, [viewsKey]);

  useEffect(() => {
    void loadViews();
  }, [loadViews]);

  async function saveCurrentView(name: string, scope: "personal" | "team") {
    setViewError(null);
    try {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ page: viewsKey, name, query: currentQuery, scope }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setViewError(data.error ?? "Could not save that view.");
        return;
      }
      setName("");
      setNaming(false);
      await loadViews();
    } catch {
      setViewError("Could not reach the server. The view was not saved.");
    }
  }

  async function removeView(id: string) {
    try {
      const res = await fetch(`/api/views/${id}`, { method: "DELETE" });
      if (res.ok) await loadViews();
    } catch {
      /* leaves the view on screen, which is better than pretending it is gone */
    }
  }

  /*
   * Put back the view you left, and say that is what happened.
   *
   * Only on a bare URL. Anything with parameters was asked for by whoever
   * followed the link, including a deliberately unfiltered one, and replacing
   * that would override an explicit request with a remembered one.
   */
  useEffect(() => {
    if (!remember) return;
    if (checkedMemory.current) return;
    checkedMemory.current = true;
    let saved: string | null = null;
    let wasRestored = false;
    try {
      saved = window.localStorage.getItem(lastKey);
      wasRestored = window.sessionStorage.getItem(restoredKey) === "1";
    } catch {
      return;
    }
    if (search.toString() !== "") {
      // Already showing something. If this render is the result of our own
      // restore, keep the notice up: it survives the remount that replace
      // can cause.
      if (wasRestored) setRestored(true);
      return;
    }
    if (!saved) return;
    try {
      window.sessionStorage.setItem(restoredKey, "1");
    } catch {
      /* the notice is a nicety; the restore is not */
    }
    setRestored(true);
    restoredQuery.current = saved;
    router.replace(`${pathname}?${saved}`);
  }, [remember, lastKey, restoredKey, pathname, router, search]);

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

  /*
   * What gets remembered: the filters, the sort and the page size, and
   * nothing else on the URL.
   *
   * Rebuilt from the parsed values rather than copied off the address bar, so
   * a page-local parameter like an open quick-look drawer is never stored and
   * never reopened days later on a record somebody has moved on from.
   */
  const rememberedQuery = useMemo(
    () =>
      buildHref(pathname, {
        filters: values,
        sort: sortParam ? parseSortParam(sortParam) : undefined,
        perPage,
      }).split("?")[1] ?? "",
    [pathname, values, sortParam, perPage]
  );

  /*
   * Written when the view changes, not when this bar navigates: sorting is
   * done from the table header, which never comes through here, and a sort
   * somebody set is as much a part of where they were as a filter is.
   *
   * The first pass after mount writes nothing. On a bare arrival the value is
   * empty, and storing that would erase the memory before the restore above
   * has had a chance to use it.
   */
  const firstPass = useRef(true);
  useEffect(() => {
    if (!remember) return;
    /*
     * Writes on the first pass only when something was asked for. A bare
     * arrival is empty and must not erase the memory; an arrival carrying
     * filters is somebody's bookmark, and skipping it meant every full page
     * load forgot the view it landed on.
     */
    if (firstPass.current) {
      firstPass.current = false;
      if (rememberedQuery === "") return;
    }
    // The view settling into what we just restored is not somebody changing
    // it, so the notice stays up.
    const isOurRestore = rememberedQuery === restoredQuery.current;
    try {
      window.localStorage.setItem(lastKey, rememberedQuery);
      if (!isOurRestore) window.sessionStorage.removeItem(restoredKey);
    } catch {
      // Storage off: the URL still holds the view for as long as you stay on it.
    }
    if (!isOurRestore) {
      restoredQuery.current = null;
      setRestored(false);
    }
  }, [remember, rememberedQuery, lastKey, restoredKey]);

  return (
    <div className="sticky top-0 z-20 border-b border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
      <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
        {/* Wide enough for the fields: they apply as they change. */}
        <div className="hidden flex-wrap items-end gap-3 lg:flex">
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

        {/* Phone: one button, and the page's own action beside it. */}
        <div className="flex items-center gap-2 lg:hidden">
          <button
            ref={sheetTrigger}
            type="button"
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className="btn-ghost inline-flex min-h-11 flex-1 items-center justify-center gap-2"
          >
            Filters
            {/* The count is on the button because a filtered list that looks
                unfiltered is the "why is this empty" trap, and on a phone the
                chips below can be scrolled past. */}
            {chips.length > 0 && (
              <span className="badge bg-gold/20 text-gold-text">{chips.length}</span>
            )}
          </button>
          {action}
        </div>

        {(chips.length > 0 || views.length > 0 || resultLabel || restored) && (
          <div className="flex flex-wrap items-center gap-2">
            {/*
              * A filtered list somebody did not filter is the "why is this
              * empty" trap arrived at from a new direction, so the restore
              * says so and puts the way out next to it.
              */}
            {restored && (
              <span className="text-xs text-muted-foreground">
                Showing the filters you left here.
              </span>
            )}
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
                onClick={() => go(clearedFilters(specs, values))}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            )}

            {chips.length > 0 && !activeView && (
              naming ? (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <input
                    autoFocus
                    className="input h-8 w-44 text-xs"
                    placeholder="Name this view"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setViewError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setNaming(false);
                      // Enter saves it as a personal view, which is the
                      // low-stakes half of the choice: a shortcut only its
                      // author sees. Sharing it with the office is a
                      // deliberate second button.
                      if (e.key === "Enter" && name.trim()) void saveCurrentView(name, "personal");
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-2 text-xs lg:min-h-0"
                    disabled={!name.trim()}
                    onClick={() => void saveCurrentView(name, "personal")}
                  >
                    Just for me
                  </button>
                  <button
                    type="button"
                    className="btn-ghost min-h-11 px-2 text-xs lg:min-h-0"
                    disabled={!name.trim()}
                    onClick={() => void saveCurrentView(name, "team")}
                    title="Everybody in this account will see it, with your name on it."
                  >
                    Share with the team
                  </button>
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      setNaming(false);
                      setViewError(null);
                    }}
                  >
                    Cancel
                  </button>
                  {viewError && (
                    <span role="alert" className="text-xs text-risk">
                      {viewError}
                    </span>
                  )}
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
                          : v.scope === "team"
                            ? "bg-gold/15 text-gold-text hover:text-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                      /* Whose filter it is, on the team ones. A shared view
                         with no author is a rule from nowhere, and the first
                         question about one is always who set it. */
                      title={
                        v.scope === "team"
                          ? `Shared with the team${v.createdBy ? ` by ${v.createdBy}` : ""}`
                          : "Only you can see this one"
                      }
                    >
                      {v.name}
                      {v.scope === "team" && <span className="sr-only"> (shared with the team)</span>}
                    </button>
                    {v.canDelete && (
                      <button
                        type="button"
                        aria-label={`Delete the ${v.name} view`}
                        title={`Delete the ${v.name} view`}
                        onClick={() => void removeView(v.id)}
                        className="px-1 text-xs text-muted-foreground hover:text-risk"
                      >
                        ×
                      </button>
                    )}
                  </span>
                ))}
              </span>
            )}
          </div>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        specs={specs}
        values={values}
        chips={chips}
        resultLabel={resultLabel}
        onApply={(next) => {
          setSheetOpen(false);
          go(next);
        }}
        onClose={() => setSheetOpen(false)}
        returnFocusTo={sheetTrigger}
      />
    </div>
  );
}

/**
 * The filters on a phone: one screen, one Apply.
 *
 * Three things it does not do, each of which was a real option.
 *
 * It does not apply on change. The bar above does, and that is right when the
 * controls stay put; here the sheet is the thing being edited, and navigating
 * on the first field would unmount it and leave the other twelve unset.
 *
 * It does not claim a count it has not got. The footer shows the count for the
 * filters actually applied, and once the draft differs it says so rather than
 * showing a number that describes a different query. Guessing would be the
 * worst version of this control: an operator narrows to one agency, reads
 * "312", and applies a filter they would not have chosen.
 *
 * And it does not sit inside the toolbar. The bar has `backdrop-blur`, which
 * makes it the containing block for anything fixed inside it, so a full-screen
 * sheet rendered there would be full-screen within a 90px strip. It goes to
 * the body through a portal.
 */
function FilterSheet({
  open,
  specs,
  values,
  chips,
  resultLabel,
  onApply,
  onClose,
  returnFocusTo,
}: {
  open: boolean;
  specs: FilterSpec[];
  values: FilterValues;
  chips: { key: string; label: string; display: string }[];
  resultLabel?: string;
  onApply: (next: FilterValues) => void;
  onClose: () => void;
  returnFocusTo: React.RefObject<HTMLElement>;
}) {
  const [pending, setPending] = useState<FilterValues>(values);
  const [mounted, setMounted] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => setMounted(true), []);

  /*
   * Opening starts from what is applied, not from whatever was abandoned last
   * time. A sheet that reopens holding a draft nobody applied is a set of
   * controls that disagree with the list behind them.
   *
   * On the transition only. `values` is rebuilt by the parent on every one of
   * its renders, so resetting whenever it changed identity would wipe a
   * half-typed filter the moment anything above re-rendered.
   */
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) setPending(values);
    wasOpen.current = open;
  }, [open, values]);

  /*
   * Focus in, focus back out, and the page behind held still.
   *
   * The scroll lock is not cosmetic on a phone: without it the list behind the
   * sheet scrolls under the finger, so closing the sheet returns the operator
   * to a different part of the list than the one they were reading.
   */
  useEffect(() => {
    if (!open) return;
    const first = panel.current?.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])"
    );
    first?.focus();
    // Held now rather than read at cleanup. It is the same button either way,
    // because the trigger stays mounted behind the sheet, but reading a ref in
    // a cleanup is the shape that breaks quietly when that stops being true.
    const opener = returnFocusTo.current;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.();
    };
  }, [open, returnFocusTo]);

  const trap = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])"
        ) ?? []
      );
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
    [onClose]
  );

  if (!open || !mounted) return null;

  const owned = specs.map((s) => s.key);
  const dirty = owned.some((k) => (pending[k] ?? "") !== (values[k] ?? ""));
  const pendingChips = activeChips(specs, pending);

  function set(key: string, value: string) {
    setPending((prev) => {
      const next = { ...prev };
      if (value.trim()) next[key] = value;
      else delete next[key];
      return next;
    });
  }

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={trap}
      className="fixed inset-0 z-[85] flex flex-col bg-background lg:hidden"
    >
      <header
        className="flex items-center justify-between gap-3 border-b border-border px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <h2 id={titleId} className="font-display text-lg font-normal text-foreground">
          Filters
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="btn-ghost min-h-11 px-3"
          // Closing keeps the list as it was. Apply is the only thing that
          // changes it, which is why this says Close and not Cancel: nothing
          // has been done yet to cancel.
        >
          Close
        </button>
      </header>

      <div className="scroll-thin flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {pendingChips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pendingChips.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => set(c.key, "")}
                className="badge inline-flex min-h-11 items-center gap-1.5 bg-gold/15 text-gold-text lg:min-h-0"
              >
                <span className="font-medium">{c.label}:</span> {c.display}
                <span aria-hidden>x</span>
                <span className="sr-only">Remove the {c.label} filter</span>
              </button>
            ))}
          </div>
        )}
        {specs.map((spec) => (
          <Control
            key={spec.key}
            spec={spec}
            value={pending[spec.key] ?? ""}
            onChange={(v) => set(spec.key, v)}
            onCommit={(v) => set(spec.key, v)}
            fullWidth
          />
        ))}
      </div>

      <footer
        className="space-y-2 border-t border-border px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {resultLabel ?? "No result count for this list."}
          {dirty && " Apply to count these filters."}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost min-h-11 flex-1"
            onClick={() => setPending(clearedFilters(specs, pending))}
            disabled={pendingChips.length === 0}
          >
            Clear
          </button>
          <button
            type="button"
            className="btn-primary min-h-11 flex-[2]"
            onClick={() => onApply(pending)}
          >
            Apply
          </button>
        </div>
      </footer>
    </div>,
    document.body
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
  fullWidth = false,
}: {
  spec: FilterSpec;
  value: string;
  onChange: (v: string) => void;
  onCommit: (v: string) => void;
  /**
   * In the sheet, where a 44px-tall field the width of a phone is easier to
   * hit than a 176px one sharing a row. The fixed widths above are what make
   * the inline bar line up, so they stay there.
   */
  fullWidth?: boolean;
}) {
  const id = `filter-${spec.key}`;

  if (spec.kind === "boolean") {
    return (
      <label
        htmlFor={id}
        title={spec.hint}
        className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted-foreground lg:min-h-0"
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
      <div className={fullWidth ? "" : "min-w-0"}>
        <label className="label mb-1 block" htmlFor={id} title={spec.hint}>
          {spec.label}
        </label>
        <select
          id={id}
          className={`input ${fullWidth ? "h-11 w-full" : "h-9 w-44"}`}
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
    <div className={fullWidth ? "" : "min-w-0"}>
      <label className="label mb-1 block" htmlFor={id} title={spec.hint}>
        {spec.label}
      </label>
      <input
        id={id}
        className={
          fullWidth
            ? "input h-11 w-full"
            : `input h-9 ${spec.kind === "min" ? "w-24" : "w-48"}`
        }
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
