"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useWorkspaceShortcut } from "@/components/workspace/workspace-keys";

/**
 * Do the thing, then land on the next one.
 *
 * Every queue in this product ended an action by refreshing the page you were
 * already on, which left the finished record on screen and the operator to go
 * and find the next row themselves. On a queue of forty that is forty
 * deliberate acts of navigation between forty pieces of actual work.
 *
 * So the action carries its successor. `nextHref` is worked out on the server
 * from the same ordering the queue is drawn in, so "next" means the next row
 * down and not whatever the list happens to look like after the refresh.
 *
 * When there is no next -- the last item, or the only one -- `doneHref` takes
 * over, and it should be the queue with nothing selected rather than the same
 * record again. Finishing the last item and being shown it again is the one
 * moment an operator cannot tell success from failure.
 */
export function AdvanceAction({
  endpoint,
  method = "POST",
  body,
  children,
  busyLabel = "Working…",
  className = "btn-ghost text-sm",
  nextHref,
  doneHref,
  shortcut,
  confirm,
  confirmLabel,
  confirmBody,
  danger = false,
  disabled = false,
  /** Shown as a toast on success. Undo, where the act is reversible. */
  toast,
  /** Called before navigating, e.g. to clear a draft. */
  onDone,
}: {
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  children: React.ReactNode;
  busyLabel?: string;
  className?: string;
  /** The next item in the queue, or null when this is the last. */
  nextHref?: string | null;
  /** Where to land when there is no next item. */
  doneHref: string;
  /** e.g. "mod+Enter". Registered only while this button is on screen. */
  shortcut?: string;
  confirm?: string;
  confirmLabel?: string;
  confirmBody?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
  toast?: { message: string; undo?: { endpoint: string; body?: Record<string, unknown> } };
  onDone?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const go = useCallback(async () => {
    if (busy) return;
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not work. Nothing was changed.");
        return;
      }
      onDone?.();
      if (toast) push(toast);
      /*
       * Navigate first, refresh second.
       *
       * The other order shows the finished record one more time while the
       * server re-renders, which on a fast connection is a flicker and on a
       * slow one is long enough to click the button again.
       */
      router.push(nextHref ?? doneHref);
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }, [busy, endpoint, method, body, onDone, toast, push, router, nextHref, doneHref]);

  const fire = useCallback(() => {
    if (disabled || busy) return;
    if (confirm) setAsking(true);
    else void go();
  }, [confirm, disabled, busy, go]);

  useWorkspaceShortcut(shortcut, fire, !disabled && !busy);

  return (
    <span className="inline-flex flex-col items-start">
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm}
          body={confirmBody}
          confirmLabel={confirmLabel ?? "Yes, do it"}
          danger={danger}
          busy={busy}
          onConfirm={() => void go()}
          onCancel={() => setAsking(false)}
        />
      )}
      <button
        type="button"
        className={className}
        onClick={fire}
        disabled={disabled || busy}
        aria-busy={busy}
      >
        {busy ? busyLabel : children}
      </button>
      {error && (
        <span role="alert" className="mt-1 max-w-[16rem] text-xs text-risk">
          {error}
        </span>
      )}
    </span>
  );
}

/**
 * Move on without changing anything.
 *
 * Distinct from every other control in the foot, and the distinction is worth
 * a separate component: skipping is the one act that must never write. An
 * operator who cannot decide an item now needs a way past it that leaves the
 * record exactly as it was, or they will guess instead, and a guess in a queue
 * like this is a real decision made for the wrong reason.
 */
export function SkipAction({
  nextHref,
  doneHref,
  label = "Skip",
  shortcut,
  className = "btn-ghost text-sm",
}: {
  nextHref?: string | null;
  doneHref: string;
  label?: string;
  shortcut?: string;
  className?: string;
}) {
  const router = useRouter();
  const go = useCallback(() => {
    router.push(nextHref ?? doneHref);
  }, [router, nextHref, doneHref]);

  useWorkspaceShortcut(shortcut, go);

  return (
    <button type="button" className={className} onClick={go}>
      {label}
    </button>
  );
}
