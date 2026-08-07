"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";

/**
 * "Not today" for a Today row. Two choices (tomorrow / in 3 days), applied
 * instantly with an Undo toast. Snoozed items return automatically; deadline
 * alerts and automation keep running while hidden.
 */
export function SnoozeButton({
  kind,
  id,
  label = "Snooze",
}: {
  kind: "opportunity" | "call_card";
  id: string;
  label?: string;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  async function snooze(until: "tomorrow" | "3d") {
    setBusy(true);
    try {
      const res = await fetch("/api/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, id, until }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        push({ message: data.error ?? "Snooze failed." });
        return;
      }
      push({
        message: `Snoozed until ${until === "tomorrow" ? "tomorrow morning" : "3 days from now"}. It comes back on its own; alerts still run.`,
        undo: { endpoint: "/api/snooze", body: { kind, id, until: null } },
      });
      router.refresh();
    } finally {
      setBusy(false);
      setOpen(false);
    }
  }

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        className="btn-ghost text-xs"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        onBlur={(e) => {
          // Close when focus leaves the whole control (button + menu).
          if (!wrapRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
        }}
      >
        {busy ? "…" : label}
      </button>
      {open && (
        <span
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 flex w-40 flex-col rounded-md border border-border bg-background py-1 shadow-lg"
        >
          <button
            role="menuitem"
            className="px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-surface"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void snooze("tomorrow")}
          >
            Until tomorrow
          </button>
          <button
            role="menuitem"
            className="px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-surface"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => void snooze("3d")}
          >
            For 3 days
          </button>
        </span>
      )}
    </span>
  );
}
