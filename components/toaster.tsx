"use client";

/**
 * Minimal global toast system, built for one job: action feedback that
 * SURVIVES the row that triggered it. When "Dismiss" archives an opportunity
 * and the page refreshes, the row (and any button-local state) unmounts, so
 * the "Dismissed · Undo" affordance must live up here at the layout level.
 *
 * Toasts say what happened and, when relevant, offer a single Undo. They
 * auto-expire; Undo calls back into the API and refreshes the view.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

export interface ToastInput {
  /** What happened, plus what happens next. */
  message: string;
  /** Optional undo: POST endpoint + body; shown as an "Undo" button. */
  undo?: { endpoint: string; body?: Record<string, unknown> };
  /** ms before auto-dismiss (longer when an Undo is offered). */
  duration?: number;
}

interface Toast extends ToastInput {
  id: number;
  undoing?: boolean;
}

const ToastContext = createContext<{ push: (t: ToastInput) => void } | null>(null);

/** No-op safe: components can call push() even if no provider is mounted. */
export function useToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? { push: () => {} };
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const remove = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      const duration = input.duration ?? (input.undo ? 8000 : 5000);
      setToasts((ts) => [...ts.slice(-2), { ...input, id }]);
      setTimeout(() => remove(id), duration);
    },
    [remove]
  );

  async function runUndo(t: Toast) {
    setToasts((ts) => ts.map((x) => (x.id === t.id ? { ...x, undoing: true } : x)));
    try {
      const res = await fetch(t.undo!.endpoint, {
        method: "POST",
        headers: t.undo!.body ? { "Content-Type": "application/json" } : undefined,
        body: t.undo!.body ? JSON.stringify(t.undo!.body) : undefined,
      });
      if (res.ok) {
        remove(t.id);
        push({ message: "Restored. It's back in your list." });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setToasts((ts) =>
          ts.map((x) =>
            x.id === t.id
              ? { ...x, undoing: false, message: data.error ?? "Undo failed.", undo: undefined }
              : x
          )
        );
      }
    } catch {
      setToasts((ts) =>
        ts.map((x) =>
          x.id === t.id ? { ...x, undoing: false, message: "Undo failed.", undo: undefined } : x
        )
      );
    }
  }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Sit above the mobile tab bar; desktop keeps a simple bottom offset. */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-[80] flex flex-col items-center gap-2 px-4 lg:bottom-4"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-md border border-border bg-foreground px-4 py-2.5 text-sm text-background shadow-2xl"
          >
            <span className="min-w-0">{t.message}</span>
            {t.undo && (
              <button
                onClick={() => void runUndo(t)}
                disabled={t.undoing}
                className="shrink-0 rounded border border-background/40 px-2.5 py-1 text-xs font-semibold hover:bg-background/10 disabled:opacity-50"
              >
                {t.undoing ? "Undoing…" : "Undo"}
              </button>
            )}
            <button
              onClick={() => remove(t.id)}
              aria-label="Close"
              className="shrink-0 text-background/60 hover:text-background"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
