"use client";

import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  RANGE_OPTIONS,
  BREAKDOWN_OPTIONS,
  type RangeKey,
  type BreakdownKey,
} from "@/lib/domain/funnel";

/**
 * Analytics on a phone.
 *
 * The desktop page is a column of eight sections, most of them tables. That is
 * the right shape on a wide screen, where the eye can skip; on 390 pixels it is
 * a scroll of several thousand pixels through tables that each need a
 * horizontal scroll of their own, and the figure somebody opened the page for
 * is somewhere in the middle of it.
 *
 * So on a phone: the numbers first, then one section at a time behind a
 * picker, and the two filters behind a button rather than eating the top of
 * the viewport. Nothing is removed, and desktop is untouched: every section
 * still renders, and the CSS simply stops hiding them above the breakpoint.
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
        className="scroll-thin -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:hidden"
        role="tablist"
        aria-label="Analytics section"
      >
        {sections.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === selected}
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
 * One section of the page: always on desktop, only when picked on a phone.
 *
 * `hidden lg:block` rather than two copies of the markup. Rendering the page
 * twice would double every query result in the DOM and give every heading and
 * form control a duplicate id, which is a real accessibility failure and not
 * a theoretical one.
 */
export function AnalyticsSection({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const selected = useContext(SectionCtx);
  return (
    <div className={selected === id ? "block" : "hidden lg:block"}>{children}</div>
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

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === range)?.label ?? "";
  const byLabel = BREAKDOWN_OPTIONS.find((o) => o.key === by)?.label ?? "";

  if (!open) {
    return (
      <button
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
  }

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
  if (!body) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Filter analytics"
      className="fixed inset-0 z-[85] flex flex-col bg-background p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] lg:hidden"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-semibold text-foreground">Filter</h2>
        <button className="btn-ghost text-sm" onClick={() => setOpen(false)}>
          Close
        </button>
      </div>
      <div className="scroll-thin mt-4 flex-1 space-y-5 overflow-y-auto">
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
    </div>,
    body
  );
}
