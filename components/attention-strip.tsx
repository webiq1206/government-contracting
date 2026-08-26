"use client";

import { useRouter } from "next/navigation";
import { useState, type MouseEvent } from "react";
import type { AttentionItem, BidReadiness } from "@/lib/domain/bid-readiness";
import { openEditorialTarget } from "@/lib/editorial-nav";

/**
 * Bid readiness buckets + attention list for the opportunity page.
 * Attention stays collapsed by default; summary shows count + first item preview.
 */
export function AttentionStrip({
  readiness,
  opportunityId,
}: {
  readiness: BidReadiness;
  opportunityId?: string;
}) {
  const items = readiness.attention;
  if (items.length === 0 && !readiness.summary) return null;

  const remaining =
    readiness.actionRequired.length + readiness.blocked.length;
  const readyForReview =
    readiness.percent >= 100 &&
    readiness.actionRequired.length === 0 &&
    readiness.blocked.length === 0;
  const preview = items[0]?.label;

  return (
    <div className="scroll-mt-editorial space-y-3" data-guide-target="attention">
      <div className="rounded-md border border-border/55 bg-surface px-4 py-4 dark:border-white/10 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
              Bid readiness
            </h2>
            <p className="mt-1 font-display text-3xl text-foreground">
              <span className="num text-gold-text">{readiness.percent}%</span>
            </p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              {readyForReview
                ? "Ready for your review"
                : remaining > 0
                  ? `Not ready · ${remaining} remaining`
                  : "In progress"}
            </p>
          </div>
          <p className="max-w-xl text-sm leading-relaxed text-slate-700">
            {readiness.summary}
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Bucket title="Complete" items={readiness.complete} tone="pursue" />
          <Bucket title="Action required" items={readiness.actionRequired} tone="review" />
          <Bucket title="Blocked" items={readiness.blocked} tone="risk" />
        </div>
      </div>

      {items.length > 0 && (
        <details
          id="attention"
          className="group scroll-mt-editorial rounded-md border border-review/50 bg-review/10 dark:bg-review/15"
        >
          <summary
            className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden"
            aria-label={`What needs your attention, ${items.length} item${
              items.length === 1 ? "" : "s"
            }. Expand for details.`}
          >
            <div className="flex items-center gap-2">
              <h2 className="min-w-0 flex-1 font-display text-lg font-semibold leading-tight text-foreground sm:text-xl">
                What needs your attention
              </h2>
              <span
                className="badge shrink-0 bg-review/20 font-semibold text-review"
                title={`${items.length} item${items.length === 1 ? "" : "s"} need attention`}
              >
                {items.length}
              </span>
              <span
                aria-hidden
                className="shrink-0 text-sm text-review transition-transform group-open:rotate-180"
              >
                ▾
              </span>
            </div>
            {preview && (
              <p className="truncate text-xs text-slate-600 group-open:hidden">
                Next: {preview}
              </p>
            )}
          </summary>
          <ul className="space-y-2 border-t border-review/30 px-4 py-3 sm:px-5">
            {items.map((item) => (
              <AttentionRow
                key={item.key}
                item={item}
                opportunityId={opportunityId}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Bucket({
  title,
  items,
  tone,
}: {
  title: string;
  items: AttentionItem[];
  tone: "pursue" | "review" | "risk";
}) {
  const border =
    tone === "pursue"
      ? "border-pursue/30"
      : tone === "risk"
        ? "border-risk/30"
        : "border-review/30";
  return (
    <div className={`rounded-md border ${border} bg-background px-3 py-2`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">None</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.slice(0, 5).map((i) => (
            <li key={i.key} className="text-xs text-slate-700">
              {i.href ? (
                <a
                  href={i.href}
                  className="hover:text-accent hover:underline"
                  onClick={(e) => onHashNav(e, i.href!)}
                >
                  {i.label}
                </a>
              ) : (
                i.label
              )}
            </li>
          ))}
          {items.length > 5 && (
            <li className="text-xs text-slate-500">+{items.length - 5} more</li>
          )}
        </ul>
      )}
    </div>
  );
}

function AttentionRow({
  item,
  opportunityId,
}: {
  item: AttentionItem;
  opportunityId?: string;
}) {
  const tone =
    item.severity === "action"
      ? "border-risk/40 bg-background"
      : item.severity === "warn"
        ? "border-review/30 bg-background"
        : "border-border bg-background";
  const whoLabel =
    item.who === "brost"
      ? "Brost Co can retrieve this"
      : item.who === "admin"
        ? "You need to act"
        : item.who === "either"
          ? "Brost Co or you"
          : null;

  return (
    <li className={`rounded-md border px-3 py-2.5 ${tone}`}>
      <p className="text-sm font-medium text-slate-900">{item.label}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{item.why}</p>
      {whoLabel && (
        <p className="mt-1 text-xs font-medium text-slate-600">{whoLabel}</p>
      )}
      {item.how && (
        <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
          How: {item.how}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <AttentionActionButton item={item} opportunityId={opportunityId} />
      </div>
    </li>
  );
}

function AttentionActionButton({
  item,
  opportunityId,
}: {
  item: AttentionItem;
  opportunityId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const label = item.action?.label ?? (item.href ? "Take care of this" : null);
  if (!label) return null;

  async function runAgent() {
    if (!opportunityId || !item.action?.agent) return;
    setBusy(true);
    try {
      await fetch(`/api/agents/${item.action.agent}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (item.action?.modal === "retry-agent" && item.action.agent && opportunityId) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={runAgent}
        className="btn-primary text-xs disabled:opacity-50"
      >
        {busy ? "Queuing…" : label}
      </button>
    );
  }

  const href = item.action?.href ?? item.href;
  if (href) {
    return (
      <a
        href={href}
        className="btn-primary text-xs"
        onClick={(e) => onHashNav(e, href)}
      >
        {label}
      </a>
    );
  }
  return null;
}

function onHashNav(e: MouseEvent<HTMLAnchorElement>, href: string) {
  if (!href.startsWith("#")) return;
  e.preventDefault();
  openEditorialTarget(href);
}
