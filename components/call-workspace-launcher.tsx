"use client";

/**
 * Client wrapper that turns a Call Card into an operator entry point:
 *   1. The whole card is a clickable target that opens the Call Workspace.
 *   2. A prominent "Start call" button opens the same workspace.
 * The workspace lazy-loads its data from the API on first open, so the parent
 * page doesn't have to serialize every call card's full context upfront.
 */

import { useState } from "react";
import { CallWorkspace, type CallWorkspaceData } from "./call-workspace";

export function CallWorkspaceLauncher({
  cardId,
  children,
  className = "",
  label = "Start call",
}: {
  cardId: string;
  children?: React.ReactNode;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CallWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function launch() {
    setOpen(true);
    if (data) return; // already loaded
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/call-cards/${cardId}/workspace`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to load call card");
      setData(body);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Whole-card click target. Keep children clickable via the wrapping button. */}
      <button
        onClick={launch}
        className={`w-full text-left ${className}`}
        aria-label="Open call workspace"
      >
        {children}
      </button>

      {open && (
        <>
          {loading && (
            <div
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            >
              <div className="rounded-md border border-border bg-background px-5 py-4 text-sm text-slate-700 shadow-2xl">
                Loading call workspace…
              </div>
            </div>
          )}
          {err && (
            <div
              onClick={() => {
                setOpen(false);
                setErr(null);
              }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            >
              <div className="max-w-md rounded-md border border-risk/40 bg-background p-5 shadow-2xl">
                <p className="text-sm font-medium text-risk">
                  Couldn&rsquo;t load the call workspace.
                </p>
                <p className="mt-1 text-xs text-slate-500">{err}</p>
                <button
                  onClick={() => {
                    setOpen(false);
                    setErr(null);
                  }}
                  className="btn-ghost mt-3"
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {data && <CallWorkspace data={data} onClose={() => setOpen(false)} />}
        </>
      )}
    </>
  );
}
