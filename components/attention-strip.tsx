"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { InfoTip } from "@/components/info-tip";
import type { AttentionItem, BidReadiness } from "@/lib/domain/bid-readiness";

/**
 * Attention-first strip + Submission Readiness buckets for the opportunity page.
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

  return (
    <div id="attention" className="scroll-mt-12 space-y-3">
      <div className="rounded-md border border-border bg-background px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="eyebrow-gold">Submission readiness</p>
            <p className="mt-1 font-display text-3xl text-foreground">
              <span className="num text-gold">{readiness.percent}%</span>
            </p>
            <p className="mt-1 text-[0.65rem] uppercase tracking-[0.14em] text-muted-foreground">
              {readiness.percent >= 100 ? "Ready for your approval" : "In progress"}
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
        <div className="rounded-md border border-review/40 bg-review/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow-gold text-review">What needs your attention</p>
            <InfoTip label="About attention items">
              Every item lists what is wrong, why it matters, who acts, and a
              direct next step. Prefer the button over hunting through tabs.
            </InfoTip>
          </div>
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <AttentionRow
                key={item.key}
                item={item}
                opportunityId={opportunityId}
              />
            ))}
          </ul>
        </div>
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
        <p className="mt-1 text-xs text-slate-400">None</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {items.slice(0, 5).map((i) => (
            <li key={i.key} className="text-xs text-slate-700">
              {i.label}
            </li>
          ))}
          {items.length > 5 && (
            <li className="text-xs text-slate-400">+{items.length - 5} more</li>
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
        ? "Admin action required"
        : item.who === "either"
          ? "Brost Co or Admin"
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
      <a href={href} className="btn-primary text-xs">
        {label}
      </a>
    );
  }
  return null;
}
