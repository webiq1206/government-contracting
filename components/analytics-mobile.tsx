"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  RANGE_OPTIONS,
  BREAKDOWN_OPTIONS,
  type RangeKey,
  type BreakdownKey,
} from "@/lib/domain/funnel";

/**
 * Focused report views on every screen size.
 *
 * The desktop page is a column of eight sections, most of them tables. That is
 * the right shape on a wide screen, where the eye can skip; on 390 pixels it is
 * a scroll of several thousand pixels through tables that each need a
 * horizontal scroll of their own, and the figure somebody opened the page for
 * is somewhere in the middle of it.
 *
 * Overview first, then the existing pipeline, win and revenue evidence in
 * separate views. No metric or filter definition changes. The two filters
 * still sit behind a sheet on phones rather than consuming the viewport.
 *
 * State is local rather than in the URL on purpose. Which section a phone is
 * looking at is not worth a navigation, and putting it in the URL would make
 * the back button walk through sections instead of leaving the page.
 */

const SectionCtx = createContext<string>("");

export interface AnalyticsSectionDef {
  id: string;
  label: string;
}

export function AnalyticsMobileNav({
  sections,
  children,
}: {
  sections: AnalyticsSectionDef[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState(sections[0]?.id ?? "");
  return (
    <SectionCtx.Provider value={selected}>
      <div
        className="flex flex-wrap gap-2 border-b border-border pb-3"
        role="group"
        aria-label="Report view"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={s.id === selected}
            onClick={() => setSelected(s.id)}
            className={`tap shrink-0 rounded-full border px-3 py-1 text-xs font-medium ${
              s.id === selected
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-surface text-slate-600"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {children}
    </SectionCtx.Provider>
  );
}

/**
 * One group of existing metrics, visible in its selected report view.
 *
 * Each metric renders once. Headline cards can belong to Overview as well as
 * their focused view without duplicating values or form-control identities.
 */
export function AnalyticsSection({
  id,
  children,
  display = "block",
}: {
  id: string | string[];
  children: React.ReactNode;
  display?: "block" | "contents";
}) {
  const selected = useContext(SectionCtx);
  const active = typeof id === "string" ? selected === id : id.includes(selected);
  return (
    <div hidden={!active} className={active ? display === "contents" ? "contents" : "block space-y-6" : undefined}>{children}</div>
  );
}

/**
 * The two filters, behind one button on a phone.
 *
 * An Apply button, deliberately, and the one place on this page that has one:
 * each control is a link, so changing one navigates, and a navigation would
 * tear the sheet down on the first thing touched.
 */
export function AnalyticsFilterSheet({
  range,
  by,
  comparison,
}: {
  range: RangeKey;
  by: BreakdownKey;
  comparison: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [nextRange, setNextRange] = useState<RangeKey>(range);
  const [nextBy, setNextBy] = useState<BreakdownKey>(by);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  // The same native-modal lifecycle used by the shared detail/confirmation
  // dialogs: browser focus containment and inert background, restored on exit.
  useEffect(() => {
    if (!open || !dialog.current) return;
    const element = dialog.current;
    const opener = trigger.current;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    close.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      opener?.focus({ preventScroll: true });
    };
  }, [open]);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === range)?.label ?? "";
  const byLabel = BREAKDOWN_OPTIONS.find((o) => o.key === by)?.label ?? "";

  const triggerButton = (
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        className="btn-ghost w-full text-sm lg:hidden"
        onClick={() => {
          setNextRange(range);
          setNextBy(by);
          setOpen(true);
        }}
      >
        {/*
          What is currently filtered, on the button. "Why does this say 3" is
          almost always the period, and the answer should not need a tap.
        */}
        {rangeLabel} · by {byLabel}
        {comparison ? ` · vs ${comparison}` : ""}
      </button>
    );

  /*
   * A real anchor rather than a scripted navigation, so middle-click,
   * long-press and the back button all behave, and the sheet cannot end up
   * out of step with the page it filtered. These two are the whole of this
   * page's state, so the URL can be written out rather than merged.
   */
  const applyHref = `/analytics?range=${nextRange}&by=${nextBy}`;

  /*
   * Portalled to the body, and that is not a detail.
   *
   * The sheet renders inside the page's scroll container, which sits under
   * ancestors that establish their own stacking contexts. A z-index set in
   * there is only relative to that context, so the mobile tab bar (a sibling
   * of the shell at z-[60]) painted over the sheet's Apply button however high
   * the number went: the button was visible, and the tap landed on whichever
   * nav icon was underneath it. The same reason the shared filter toolbar
   * portals its sheet.
   */
  const body = typeof document === "undefined" ? null : document.body;
  if (!open || !body) return triggerButton;

  return <>{triggerButton}{createPortal(
    <dialog
      ref={dialog}
      id={id}
      aria-modal="true"
      aria-label="Filter analytics"
      onCancel={(event) => { event.preventDefault(); setOpen(false); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex="0"]'
        )).filter(control => control.getClientRects().length > 0);
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      className="fixed inset-0 m-0 flex h-dvh max-h-dvh w-full max-w-none flex-col border-0 bg-background p-5 text-foreground pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-foreground">Filter</h2>
        <button ref={close} type="button" className="btn-ghost text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="scroll-thin mt-4 min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain">
        <fieldset>
          <legend className="label mb-2">Period</legend>
          <div className="flex flex-wrap gap-1.5">
            {RANGE_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => setNextRange(o.key)}
                aria-pressed={o.key === nextRange}
                className={`tap rounded-full border px-3 py-1.5 text-sm font-medium ${
                  o.key === nextRange
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-slate-600"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label mb-2">Break down by</legend>
          <div className="flex flex-wrap gap-1.5">
            {BREAKDOWN_OPTIONS.map((o) => (
              <button
                key={o.key}
                onClick={() => setNextBy(o.key)}
                aria-pressed={o.key === nextBy}
                className={`tap rounded-full border px-3 py-1.5 text-sm font-medium ${
                  o.key === nextBy
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border bg-surface text-slate-600"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
      </div>
      <Link
        href={applyHref}
        className="btn-primary mt-4 block text-center"
        onClick={() => setOpen(false)}
      >
        Show these
      </Link>
    </dialog>,
    body
  )}</>;
}
