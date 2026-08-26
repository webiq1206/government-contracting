"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";
import { ReasonDialog } from "@/components/confirm-dialog";
import { snoozeUntilLabel, type SnoozeUntilChoice } from "@/lib/domain/snooze";

interface BulkSelectionValue {
  selected: Set<string>;
  selectedIds: string[];
  allIds: string[];
  allSelected: boolean;
  someSelected: boolean;
  toggle: (id: string) => void;
  toggleAll: () => void;
  clear: () => void;
}

const BulkSelectionContext = createContext<BulkSelectionValue | null>(null);

export function BulkSelectionProvider({
  ids,
  children,
}: {
  ids: string[];
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const allIds = ids;

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (allIds.length > 0 && allIds.every((id) => prev.has(id))) {
        return new Set();
      }
      return new Set(allIds);
    });
  }, [allIds]);

  const clear = useCallback(() => setSelected(new Set()), []);

  const value = useMemo<BulkSelectionValue>(() => {
    const selectedIds = allIds.filter((id) => selected.has(id));
    return {
      selected,
      selectedIds,
      allIds,
      allSelected: allIds.length > 0 && selectedIds.length === allIds.length,
      someSelected: selectedIds.length > 0,
      toggle,
      toggleAll,
      clear,
    };
  }, [allIds, selected, toggle, toggleAll, clear]);

  return (
    <BulkSelectionContext.Provider value={value}>
      {children}
    </BulkSelectionContext.Provider>
  );
}

export function useBulkSelection(): BulkSelectionValue {
  const ctx = useContext(BulkSelectionContext);
  if (!ctx) {
    throw new Error("useBulkSelection must be used within BulkSelectionProvider");
  }
  return ctx;
}

export function BulkSelectCheckbox({
  id,
  label,
  className = "",
}: {
  id: string;
  label: string;
  className?: string;
}) {
  const { selected, toggle } = useBulkSelection();
  return (
    <label
      className={`inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center md:min-h-0 md:min-w-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
        checked={selected.has(id)}
        onChange={() => toggle(id)}
        aria-label={label}
      />
    </label>
  );
}

export function BulkSelectAllCheckbox({
  label = "Select all",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  const { allSelected, someSelected, toggleAll, allIds } = useBulkSelection();
  if (allIds.length === 0) return null;
  return (
    <label
      className={`inline-flex min-h-11 cursor-pointer items-center gap-2 py-2 pr-2 text-sm md:min-h-0 md:py-0 md:pr-0 ${className}`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
        checked={allSelected}
        ref={(el) => {
          if (el) el.indeterminate = someSelected && !allSelected;
        }}
        onChange={toggleAll}
        aria-label={label}
      />
      <span className="text-muted-foreground">{label}</span>
    </label>
  );
}

type BulkAction =
  | { kind: "skip_calls"; label?: string }
  | { kind: "snooze_calls" }
  | { kind: "snooze_opps" }
  | { kind: "pursue"; label?: string }
  | { kind: "dismiss"; label?: string; confirm?: string };

/**
 * Sticky bar when one or more rows are selected. Runs /api/bulk then refreshes.
 */
export function BulkActionBar({
  actions,
  noun,
}: {
  actions: BulkAction[];
  /** Singular noun for copy, e.g. "call" or "opportunity". */
  noun: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const { selectedIds, clear, someSelected } = useBulkSelection();
  const [busy, setBusy] = useState(false);
  const [askingWhy, setAskingWhy] = useState(false);

  if (!someSelected) return null;

  const n = selectedIds.length;
  const plural = n === 1 ? noun : `${noun}s`;

  async function run(body: Record<string, unknown>, success: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, ids: selectedIds }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        processed?: number;
      };
      if (!res.ok) {
        push({ message: data.error ?? "Bulk action failed." });
        return;
      }
      push({
        message:
          typeof data.processed === "number"
            ? `${success} (${data.processed} ${data.processed === 1 ? noun : `${noun}s`}).`
            : success,
      });
      clear();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function snooze(kind: "call_card" | "opportunity", until: SnoozeUntilChoice) {
    if (busy) return;
    await run(
      { action: "snooze", kind, until },
      `Snoozed until ${snoozeUntilLabel(until)}`
    );
  }

  const showCallSnooze = actions.some((a) => a.kind === "snooze_calls");
  const showOppSnooze = actions.some((a) => a.kind === "snooze_opps");
  const skip = actions.find((a) => a.kind === "skip_calls");
  const pursue = actions.find((a) => a.kind === "pursue");
  const dismiss = actions.find((a) => a.kind === "dismiss");

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-3 md:bottom-6">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 shadow-lg dark:border-white/15">
        <span className="text-sm font-medium text-foreground">{n} selected</span>
        <button
          type="button"
          className="btn-ghost text-xs"
          disabled={busy}
          onClick={clear}
        >
          Clear
        </button>
        {skip && (
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={busy}
            onClick={() => void run({ action: "skip_calls" }, `Skipped selected ${plural}`)}
          >
            {busy ? "Working…" : skip.label ?? "Skip"}
          </button>
        )}
        {showCallSnooze && (
          <>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void snooze("call_card", "tomorrow")}
            >
              Snooze tomorrow
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void snooze("call_card", "3d")}
            >
              Snooze 3 days
            </button>
          </>
        )}
        {showOppSnooze && (
          <>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void snooze("opportunity", "tomorrow")}
            >
              Snooze tomorrow
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              disabled={busy}
              onClick={() => void snooze("opportunity", "3d")}
            >
              Snooze 3 days
            </button>
          </>
        )}
        {pursue && (
          <button
            type="button"
            className="btn-success text-xs"
            disabled={busy}
            onClick={() => void run({ action: "pursue" }, `Pursued selected ${plural}`)}
          >
            {pursue.label ?? "Pursue"}
          </button>
        )}
        {dismiss && (
          <ReasonDialog
            open={askingWhy}
            title={`Passing on ${n} ${plural}`}
            body={
              dismiss.confirm ??
              "One line is enough, and it is what the scoring learns from."
            }
            placeholder="Too small, wrong trade, outside our area"
            confirmLabel={`Pass on ${n} ${plural}`}
            danger
            busy={busy}
            onConfirm={(reason) =>
              void run({ action: "dismiss", reason }, `Passed on selected ${plural}`)
            }
            onCancel={() => setAskingWhy(false)}
          />
        )}
        {dismiss && (
          <button
            type="button"
            className="btn-danger text-xs"
            disabled={busy}
            /*
             * A reason, not a confirmation. "Are you sure?" is answered yes
             * every time and teaches nothing; the reason is what the scoring
             * reads to learn what this company does not want.
             *
             * `window.prompt` could ask but could not validate, so a
             * two-character answer closed the dialog, produced a toast, and
             * made the operator reopen it and retype. The reason box now
             * refuses in place.
             */
            onClick={() => setAskingWhy(true)}
          >
            {dismiss.label ?? "Pass"}
          </button>
        )}
      </div>
    </div>
  );
}
