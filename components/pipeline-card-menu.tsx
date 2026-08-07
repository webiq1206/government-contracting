"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

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

type Action = "pursue" | "dismiss" | "rerun" | "send_back";

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

  async function run(e: React.MouseEvent, action: Action, confirmText?: string) {
    stop(e);
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-surface hover:text-slate-700"
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
              <span className="text-accent-strong">Pursue now</span>
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
                msg.ok ? "text-accent" : "text-risk"
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
