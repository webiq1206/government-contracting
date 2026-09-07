"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { moveTargetsFrom } from "@/lib/domain/row-actions";

/**
 * The per-card override menu on the Pipeline board. Lets an operator act on a
 * card without opening the full record: promote it, dismiss it, send it back a
 * stage, or re-run a stalled agent. Lives inside the card's <Link>, so every
 * handler stops propagation and prevents the default navigation.
 */

// Stages that a machine agent produces, so "re-run this stage" is meaningful.
const AGENT_STAGES = new Set([
  "scoring",
  "analysis",
  "sub_research",
  "outreach",
  "call_queue",
  "bid_building",
]);
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
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const frame = window.requestAnimationFrame(() => {
      wrapRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    });
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
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

  const moveTargets = moveTargetsFrom(stage);
  const canPursue = stage === "scoring";
  const canRerun = AGENT_STAGES.has(stage);
  const canDismiss = [
    "monitoring",
    "scoring",
    "analysis",
    "sub_research",
    "outreach",
    "call_queue",
    "quote_entry",
    "bid_building",
  ].includes(stage);
  const hasActions = canPursue || canRerun || canDismiss || moveTargets.length > 0;

  if (!hasActions) return null;

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
        ref={triggerRef}
        type="button"
        aria-label="Card actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          stop(e);
          setOpen((o) => !o);
          setMsg(null);
        }}
        className="tap flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-surface hover:text-slate-700 lg:h-7 lg:w-7"
      >
        <span className="text-lg leading-none">⋯</span>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Opportunity actions"
          className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-50 max-h-[calc(100dvh-8rem)] overflow-y-auto rounded-t-xl border border-foreground/50 bg-background py-1 text-sm shadow-lg dark:border-white/35 lg:absolute lg:inset-x-auto lg:bottom-auto lg:right-0 lg:top-8 lg:w-56 lg:rounded-md"
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
          {/* Move to any stage: touch-friendly parity with drag-and-drop.
              The route redirects the call stage when calling is off and
              re-runs the target stage's agents, same as a drop. */}
          {moveTargets.length > 0 && (
            <>
              <div className="border-t border-border px-3 pb-1 pt-2 text-[0.65rem] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Move one step
              </div>
              <div className="flex flex-wrap gap-1 px-3 pb-2">
                {moveTargets.map((t) => (
                  <button
                    key={t.stage}
                    type="button"
                    disabled={busy}
                    onClick={(e) => run(e, "move", undefined, t.stage)}
                    className="inline-flex min-h-11 items-center rounded border border-foreground/50 px-2 py-1 text-xs text-foreground transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-40 dark:border-white/35"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {canDismiss && (
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
          )}

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
      className={`block min-h-11 w-full px-3 py-2 text-left transition-colors hover:bg-surface disabled:opacity-50 ${
        danger ? "text-risk" : "text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
