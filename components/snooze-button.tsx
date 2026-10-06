"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useToast } from "@/components/toaster";
import { ACTION_UNCONFIRMED, requestAction } from "@/lib/client/action-request";

/**
 * "Not today" for a Today row. Two choices (tomorrow / in 3 days), applied
 * instantly with an Undo toast. Snoozed items return automatically; deadline
 * alerts and automation keep running while hidden.
 */
export function SnoozeButton({
  kind,
  id,
  label = "Snooze",
  className = "btn-ghost coarse:min-h-11 text-xs",
  onSnoozed,
  disabled = false,
  onPending,
  onUnconfirmed,
}: {
  kind: "opportunity" | "call_card";
  id: string;
  label?: string;
  className?: string;
  onSnoozed?: () => void;
  disabled?: boolean;
  onPending?: (pending: boolean) => void;
  onUnconfirmed?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { setError(null); setBusy(false); setOpen(false); return () => { inFlight.current?.abort(); inFlight.current = null; }; }, [id]);

  async function snooze(until: "tomorrow" | "3d") {
    if (inFlight.current || disabled || error === ACTION_UNCONFIRMED) return;
    const controller = new AbortController(); inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    setBusy(true);
    setError(null);
    onPending?.(true);
    try {
      const result = await requestAction("/api/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, until }),
        signal: controller.signal,
      });
      if (inFlight.current !== controller) return;
      if (!result.ok) {
        setError(result.error);
        if (result.error === ACTION_UNCONFIRMED) onUnconfirmed?.();
        return;
      }
      push({
        message: `Snoozed until ${until === "tomorrow" ? "tomorrow morning" : "3 days from now"}. It comes back on its own; alerts still run.`,
        undo: { endpoint: "/api/snooze", body: { kind, id, until: null } },
      });
      onSnoozed?.();
      router.refresh();
    } finally {
      clearTimeout(timer);
      if (inFlight.current === controller) {
        inFlight.current = null;
        setBusy(false);
        onPending?.(false);
        setOpen(false);
      }
    }
  }

  return (
    <span ref={wrapRef} className="relative inline-flex flex-wrap" onKeyDown={event => {
      if (event.key === "Escape") { setOpen(false); wrapRef.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    }} onBlur={event => {
      if (!wrapRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
    }}>
      <button
        type="button"
        className={className}
        aria-expanded={open}
        disabled={busy || disabled || error === ACTION_UNCONFIRMED}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        onBlur={(e) => {
          // Close when focus leaves the whole control (button + menu).
          if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      >
        {busy ? "…" : label}
      </button>
      {open && (
        <span
          className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col rounded-md border border-border bg-background py-1 shadow-lg"
        >
          <button
            type="button"
            className="min-h-11 px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void snooze("tomorrow")}
          >
            Until tomorrow
          </button>
          <button
            type="button"
            className="min-h-11 px-3 py-2 text-left text-sm text-foreground hover:bg-surface"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void snooze("3d")}
          >
            For 3 days
          </button>
        </span>
      )}
      {error && <span role="alert" className="mt-2 basis-full text-sm text-risk">{error}{error === ACTION_UNCONFIRMED && <Link href={kind === "opportunity" ? `/opportunity/${id}` : "/call-queue"} className="mt-2 inline-flex min-h-11 items-center underline">Check current status</Link>}</span>}
    </span>
  );
}
