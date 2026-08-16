"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Hover preview for board cards.
 *
 * A card can only carry a title, a score and a deadline, so deciding whether
 * an opportunity is worth opening meant opening it, then coming back. This
 * shows the rest, the verdict, the trades and their coverage, and the next
 * action, in a panel beside the card without leaving the board.
 *
 * Fetched on first hover rather than rendered up front: the board holds up
 * to 500 cards and almost none of them get hovered. Results are cached for
 * the life of the page, so a second look is instant, and in-flight requests
 * are shared so crossing a card twice does not fetch twice.
 *
 * Pointer-only by design. On touch there is no hover to speak of and a
 * long-press preview competes with scrolling, so the card keeps its normal
 * behaviour: tap opens the record.
 */

export interface CardPreviewData {
  title: string | null;
  agency: string | null;
  solicitationNumber: string | null;
  stageLabel: string;
  score: number | null;
  tier: string | null;
  deadline: string | null;
  valueEstimated: number | null;
  why: string | null;
  trades: { trade: string; status: string; statusLabel: string }[];
  tradesPriced: number;
  tradeCount: number;
  nextStep: { title: string; why: string; waitingOn: string } | null;
}

const cache = new Map<string, CardPreviewData>();
const inFlight = new Map<string, Promise<CardPreviewData | null>>();

function load(id: string): Promise<CardPreviewData | null> {
  const hit = cache.get(id);
  if (hit) return Promise.resolve(hit);
  const pending = inFlight.get(id);
  if (pending) return pending;
  const p = fetch(`/api/opportunities/${id}/preview`)
    .then((r) => (r.ok ? (r.json() as Promise<CardPreviewData>) : null))
    .then((d) => {
      if (d) cache.set(id, d);
      return d;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(id));
  inFlight.set(id, p);
  return p;
}

/** Long enough that crossing the board does not fire a request per card. */
const OPEN_DELAY_MS = 400;

const TRADE_TONE: Record<string, string> = {
  complete: "bg-pursue/15 text-pursue",
  in_progress: "bg-accent/15 text-accent-strong",
  action_required: "bg-risk/15 text-risk",
  empty: "bg-risk/15 text-risk",
};

/**
 * The panel's contents, split from the hover machinery above so the design
 * can be rendered (and checked) without a pointer or a database behind it.
 */
export function CardPreviewBody({ data }: { data: CardPreviewData }) {
  return (
    <>
      <p className="text-sm font-semibold leading-snug text-foreground">
        {data.title ?? "Untitled"}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {[data.agency, data.solicitationNumber].filter(Boolean).join(" · ") ||
          data.stageLabel}
      </p>

      {data.why && (
        <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-slate-700">
          {data.why}
        </p>
      )}

      {data.tradeCount > 0 && (
        <div className="mt-2.5">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {data.tradeCount === 1 ? "1 trade needed" : `${data.tradeCount} trades needed`}
            {": "}
            {data.tradesPriced} priced
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            {data.trades.slice(0, 6).map((t) => (
              <span
                key={t.trade}
                className={`badge ${TRADE_TONE[t.status] ?? ""}`}
                title={t.statusLabel}
              >
                {t.trade}
              </span>
            ))}
          </div>
        </div>
      )}

      {data.nextStep && (
        <div className="mt-2.5 border-t border-border/60 pt-2">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Next step
          </p>
          <p className="mt-0.5 text-xs font-medium text-foreground">
            {data.nextStep.title}
          </p>
        </div>
      )}
    </>
  );
}

export function CardPreview({
  opportunityId,
  children,
}: {
  opportunityId: string;
  children: ReactNode;
}) {
  const [data, setData] = useState<CardPreviewData | null>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const place = useCallback(() => {
    // Measure the card, not this wrapper: the wrapper is a block element and
    // stretches to the column's full width, which put the panel a column away
    // from the card it describes and flipped it to the wrong side.
    const el = hostRef.current?.firstElementChild ?? hostRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const W = 340;
    const H = 340;
    // Prefer the right of the card, flip left when it would leave the
    // viewport, then clamp vertically so the panel is never half off screen.
    const left = r.right + 12 + W < window.innerWidth ? r.right + 12 : r.left - W - 12;
    const top = Math.min(Math.max(8, r.top), Math.max(8, window.innerHeight - H - 8));
    setPos({ top, left: Math.max(8, left) });
  }, []);

  const show = useCallback(() => {
    // Devices without a real pointer never open this.
    if (typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches) {
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      place();
      setOpen(true);
      void load(opportunityId).then((d) => {
        if (alive.current && d) setData(d);
      });
    }, OPEN_DELAY_MS);
  }, [opportunityId, place]);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  }, []);

  return (
    <div
      ref={hostRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {open && pos && (
        <div
          role="tooltip"
          style={{ top: pos.top, left: pos.left, width: 340 }}
          className="pointer-events-none fixed z-50 rounded-md border border-border/75 bg-surface-raised p-3 shadow-xl dark:border-white/[0.17]"
        >
          {!data ? (
            <p className="text-xs text-muted-foreground">Loading the details…</p>
          ) : (
            <CardPreviewBody data={data} />
          )}
        </div>
      )}
    </div>
  );
}
