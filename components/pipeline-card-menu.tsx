"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * The per-card override menu on the Pipeline board. Lets an operator act on a
 * card without opening the full record: promote it, dismiss it, send it back a
 * stage, or re-run a stalled agent. Lives inside the card's <Link>, so every
 * handler stops propagation and prevents the default navigation.
 */

const MOVE_TARGETS: { key: string; label: string }[] = [
  { key: "scoring", label: "Scoring" },
  { key: "analysis", label: "Analysis" },
  { key: "sub_research", label: "Sub research" },
  { key: "outreach", label: "Outreach" },
  { key: "call_queue", label: "Calls" },
  { key: "quote_entry", label: "Quotes" },
  { key: "bid_building", label: "Bid building" },
  { key: "submitted", label: "Submitted" },
];

// Stages that a machine agent produces, so "re-run this stage" is meaningful.
const AGENT_STAGES = new Set([
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "bid_building",
]);
// Order used to decide whether "send back" is possible (must be past scoring).
const STAGE_ORDER = [
  "monitoring",
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "quote_entry",
  "bid_building",
  "submitted",
];

type Action = "pursue" | "dismiss" | "rerun" | "send_back" | "move";

export function PipelineCardMenu({
  opportunityId,
  stage,
}: {
  opportunityId: string;
  stage: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{
    action: Action;
    confirmText: string;
    targetStage?: string;
  } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function stop(e: React.SyntheticEvent) {
    e.preventDefault();
    e.stopPropagation();
  }

  async function run(
    e: React.MouseEvent,
    action: Action,
    confirmText?: string,
    targetStage?: string
  ) {
    stop(e);
    if (confirmText) {
      // Held rather than fired: the dialog asks, and its confirm button calls
      // back into this function with the text already cleared.
      setPending({ action, confirmText, targetStage });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targetStage ? { action, stage: targetStage } : { action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setMsg({ ok: false, text: data.error ?? "That did not work." });
      }
    } catch {
      setMsg({ ok: false, text: "Network error. Try again." });
    } finally {
      setBusy(false);
    }
  }

  const idx = STAGE_ORDER.indexOf(stage);
  const canPursue = stage === "monitoring" || stage === "scoring";
  const canRerun = AGENT_STAGES.has(stage);
  const canSendBack = idx > 1;
  const prevLabel =
    canSendBack ? STAGE_ORDER[idx - 1].replace(/_/g, " ") : "";

  return (
    <div ref={wrapRef} className="relative shrink-0" onClick={stop}>
      <ConfirmDialog
        open={pending != null}
        title={pending?.confirmText ?? ""}
        confirmLabel="Yes, do it"
        danger
        busy={busy}
        onConfirm={() => {
          const p = pending;
          setPending(null);
          if (p) {
            void run(
              { stopPropagation: () => {}, preventDefault: () => {} } as React.MouseEvent,
              p.action,
              undefined,
              p.targetStage
            );
          }
        }}
        onCancel={() => setPending(null)}
      />
      <button
        type="button"
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          stop(e);
          setOpen((o) => !o);
          setMsg(null);
        }}
        className="flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-surface hover:text-slate-700 md:h-7 md:w-7"
      >
        <span className="text-lg leading-none">⋯</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-30 w-56 overflow-hidden rounded-md border border-border bg-background py-1 text-sm shadow-lg"
        >
          {canPursue && (
            <MenuItem disabled={busy} onClick={(e) => run(e, "pursue")}>
              <span className="text-pursue-strong">Pursue now</span>
              <span className="block text-xs text-slate-500">
                Skip ahead and start the analysis
              </span>
            </MenuItem>
          )}
          {canRerun && (
            <MenuItem disabled={busy} onClick={(e) => run(e, "rerun")}>
              Re-run this stage
              <span className="block text-xs text-slate-500">
                Use if an agent looks stuck
              </span>
            </MenuItem>
          )}
          {canSendBack && (
            <MenuItem disabled={busy} onClick={(e) => run(e, "send_back")}>
              Send back a stage
              <span className="block text-xs text-slate-500">
                Return to {prevLabel} and redo it
              </span>
            </MenuItem>
          )}
          {/* Move to any stage: touch-friendly parity with drag-and-drop.
              The route redirects the call stage when calling is off and
              re-runs the target stage's agents, same as a drop. */}
          <div className="border-t border-border px-3 pb-1 pt-2 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Move to
          </div>
          <div className="flex flex-wrap gap-1 px-3 pb-2">
            {MOVE_TARGETS.filter((t) => t.key !== stage).map((t) => (
              <button
                key={t.key}
                type="button"
                disabled={busy}
                onClick={(e) => run(e, "move", undefined, t.key)}
                className="rounded border border-border px-2 py-1 text-xs text-foreground transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-40"
              >
                {t.label}
              </button>
            ))}
          </div>
          <MenuItem
            disabled={busy}
            danger
            onClick={(e) =>
              run(e, "dismiss", "Dismiss this opportunity? It moves to the archive.")
            }
          >
            Dismiss
            <span className="block text-xs text-slate-500">
              Stop working it and archive
            </span>
          </MenuItem>

          {msg && (
            <p
              className={`border-t border-border px-3 py-2 text-xs ${
                msg.ok ? "text-pursue" : "text-risk"
              }`}
            >
              {msg.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`block w-full px-3 py-2 text-left transition-colors hover:bg-surface disabled:opacity-50 ${
        danger ? "text-risk" : "text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
