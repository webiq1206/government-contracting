"use client";

/**
 * A horizontal, swipeable rail of columns for small screens.
 *
 * The pipeline is a pipeline: stages run left to right, and each one holds
 * work. On mobile that was thrown away and every stage was stacked down the
 * page, so the shape of the thing disappeared and reaching the last stage
 * meant scrolling past every card in the eight before it.
 *
 * This keeps the horizontal arrangement and makes it native to touch:
 *
 *   - each column is one snap point, sized so the next one peeks past the
 *     edge, which is the affordance that says "there is more this way"
 *   - a chip rail above names every stage with its count, marks where you
 *     are, and jumps straight to any of them, so the far end is one tap away
 *     rather than eight swipes
 *   - the chip rail scrolls itself to keep the active chip in view
 *   - edges fade only on the side that has more content, so the cue is
 *     information rather than decoration
 *
 * Columns are rendered by the server and passed in as children; this handles
 * only the movement.
 */

import { Children, useCallback, useEffect, useRef, useState } from "react";

export interface RailItem {
  key: string;
  label: string;
  count: number;
  /** Rendered next to the label in the chip. Keep it to a word. */
  badge?: string;
  /** Marks the chip as work waiting on a person. */
  attention?: boolean;
}

export function SwipeRail({
  items,
  children,
  ariaLabel,
}: {
  items: RailItem[];
  children: React.ReactNode;
  ariaLabel: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<(HTMLDivElement | null)[]>([]);
  const chips = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  /**
   * One child per item, in the same order. Each child must be a SINGLE
   * element: Children.toArray flattens a fragment into its parts, so a column
   * returning `<>header, list</>` silently becomes two snap columns, both
   * clipped at the edge. The mismatch is loud in development rather than
   * something you discover on a phone.
   */
  const nodes = Children.toArray(children);
  if (process.env.NODE_ENV !== "production" && nodes.length !== items.length) {
    console.error(
      `[SwipeRail] ${nodes.length} children for ${items.length} items. ` +
        `Each column must be one element, not a fragment.`
    );
  }

  const sync = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    // Bias a third of a screen in, so a column counts as current once it is
    // genuinely the one being read rather than the moment it appears.
    const mark = el.scrollLeft + el.clientWidth / 3;
    let idx = 0;
    columns.current.forEach((col, i) => {
      if (col && col.offsetLeft <= mark) idx = i;
    });
    setActive(idx);
    setAtStart(el.scrollLeft <= 4);
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    sync();
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sync]);

  // Keep the active chip visible without dragging the page around it.
  useEffect(() => {
    chips.current[active]?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "nearest",
      block: "nearest",
    });
  }, [active]);

  function goTo(i: number) {
    columns.current[i]?.scrollIntoView({
      behavior: prefersReducedMotion() ? "auto" : "smooth",
      inline: "start",
      block: "nearest",
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Where you are, and every other stage one tap away. */}
      <div
        className="hide-scrollbar flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2"
        role="tablist"
        aria-label={`${ariaLabel} stages`}
      >
        {items.map((item, i) => {
          const current = i === active;
          return (
            <button
              key={item.key}
              ref={(el) => {
                chips.current[i] = el;
              }}
              type="button"
              role="tab"
              aria-selected={current}
              onClick={() => goTo(i)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition ${
                current
                  ? "border-accent bg-accent text-white"
                  : item.attention
                    ? "border-review/40 bg-review/10 text-review"
                    : "border-border bg-surface text-muted-foreground"
              }`}
            >
              <span className="whitespace-nowrap font-medium">{item.label}</span>
              <span
                className={`tabular-nums ${current ? "text-white/80" : "opacity-70"}`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={scroller}
          role="group"
          aria-label={ariaLabel}
          // scroll-pl-4 matches px-4. Without it, mandatory snapping aligns a
          // snap-start column to the scrollport edge and ignores the padding,
          // so on load the rail scrolls itself by exactly the padding width
          // and the first column's heading clips against the screen edge.
          className="scroll-thin flex h-full snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden px-4 pb-4 scroll-pl-4"
        >
          {nodes.map((node, i) => (
            <div
              key={items[i]?.key ?? i}
              ref={(el) => {
                columns.current[i] = el;
              }}
              // 84vw leaves the next column visibly peeking, which is what
              // tells a thumb there is more to the right.
              className="flex w-[84vw] max-w-sm shrink-0 snap-start flex-col"
              aria-label={items[i]?.label}
            >
              {node}
            </div>
          ))}
        </div>

        {/* Only the side that actually has more content fades. */}
        {!atStart && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent"
          />
        )}
        {!atEnd && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
          />
        )}
      </div>
    </div>
  );
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}
