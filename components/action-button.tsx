"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";
import { requestAction, ACTION_UNCONFIRMED } from "@/lib/client/action-request";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface ActionButtonProps {
  endpoint: string;
  method?: "POST" | "GET";
  body?: Record<string, unknown>;
  className?: string;
  children: React.ReactNode;
  /**
   * A question to ask first. Rendered in the product's own dialog rather than
   * the browser's: `window.confirm` cannot say what the action costs, cannot
   * be styled to belong to the record it is about, and blocks the main thread
   * while it is open.
   */
  confirm?: string;
  /**
   * What the action does, and what it does not, under the question.
   *
   * The title alone can only name the record. "Abort this bid?" and "Delete
   * this rule?" both read as small until somebody is told that the first
   * stops eleven queued messages and the second cannot be undone.
   */
  confirmBody?: React.ReactNode;
  /** Names the act in the dialog's own button. Defaults to the button's label. */
  confirmLabel?: string;
  /** Red rather than accent, for the ones that remove something. */
  danger?: boolean;
  /** Called with the JSON response on success. */
  onDone?: (data: unknown) => void;
  refresh?: boolean;
  /**
   * Short confirmation shown next to the button after success (e.g.
   * "Pursued, analysis started"). Says what happened AND what happens next,
   * so the operator is never left wondering whether the click worked.
   */
  successText?: string;
  /**
   * Success feedback as a global toast instead of inline text. Survives the
   * refresh that removes this button's row, so pair it with `undo` for
   * immediate-but-reversible actions (the modern replacement for a native
   * confirm dialog).
   */
  toast?: {
    message: string;
    undo?: { endpoint: string; body?: Record<string, unknown> };
  };
}

/** Generic button that calls an API route, shows a spinner, and refreshes the view. */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  className = "btn-ghost",
  children,
  confirm,
  onDone,
  refresh = true,
  successText,
  toast,
  confirmBody,
  confirmLabel,
  danger = false,
}: ActionButtonProps) {
  const router = useRouter();
  const { push } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [asking, setAsking] = useState(false);
  const inFlight = useRef<AbortController | null>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearDoneTimer() {
    if (doneTimer.current) {
      clearTimeout(doneTimer.current);
      doneTimer.current = null;
    }
  }

  // After router.refresh() removes a list row, Next can reuse this client
  // instance for the next row by tree position. Reset so the next opportunity
  // never inherits "done" / loading UI (which also stretched the button).
  const bodyKey = body ? JSON.stringify(body) : "";
  useEffect(() => {
    clearDoneTimer();
    setLoading(false);
    setError(null);
    setDone(false);
    return () => {
      clearDoneTimer();
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [endpoint, method, bodyKey]);

  async function go() {
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    setAsking(false);
    setLoading(true);
    setError(null);
    try {
      const result = await requestAction(endpoint, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (inFlight.current !== controller) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const data = result.data;
      onDone?.(data);
      if (toast) push(toast);
      if (successText) {
        setDone(true);
        clearDoneTimer();
        doneTimer.current = setTimeout(() => {
          setDone(false);
          doneTimer.current = null;
        }, 6000);
      }
      if (refresh) router.refresh();
    } catch {
      if (inFlight.current === controller) setError(ACTION_UNCONFIRMED);
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setLoading(false);
      }
    }
  }

  return (
    // items-start: success/error copy must not stretch the button to its width
    // (flex-col defaults to stretch on the cross axis).
    <span className="inline-flex flex-col items-start">
      {confirm && (
        <ConfirmDialog
          open={asking}
          title={confirm}
          body={confirmBody}
          confirmLabel={confirmLabel ?? "Yes, do it"}
          danger={danger}
          busy={loading}
          onConfirm={go}
          onCancel={() => setAsking(false)}
        />
      )}
      <button
        className={className}
        onClick={() => (confirm ? setAsking(true) : void go())}
        disabled={loading}
        aria-busy={loading}
      >
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Working…
          </span>
        ) : (
          children
        )}
      </button>
      {error && <span role="alert" className="mt-1 max-w-[16rem] text-xs text-risk">{error}{" "}
        <button type="button" className="min-h-11 underline" onClick={() => router.refresh()}>Check current status</button>
      </span>}
      {done && !error && (
        <span aria-live="polite" className="mt-1 max-w-[16rem] text-xs text-pursue">
          ✓ {successText}
        </span>
      )}
    </span>
  );
}
