"use client";

/**
 * Client wrapper that turns a Call Card into an operator entry point:
 *   1. The whole card is a clickable target that opens the Call Workspace.
 *   2. A prominent "Start call" button opens the same workspace.
 * The workspace lazy-loads its data from the API on first open, so the parent
 * page doesn't have to serialize every call card's full context upfront.
 */

import { useEffect, useRef, useState } from "react";
import { CallWorkspace, type CallWorkspaceData } from "./call-workspace";
import { ConfirmDialog } from "./confirm-dialog";

export function CallWorkspaceLauncher({
  cardId,
  children,
  className = "",
  label = "Start call",
  autoOpen = false,
}: {
  cardId: string;
  children?: React.ReactNode;
  className?: string;
  label?: string;
  /** Open the workspace immediately on mount (deep links: /call-queue?open=<id>). */
  autoOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CallWorkspaceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoOpened = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    if (autoOpen && !autoOpened.current) {
      autoOpened.current = true;
      void launch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen]);

  useEffect(
    () => () => {
      activeRequest.current?.abort();
    },
    []
  );

  async function launch() {
    setOpen(true);
    if (data) return; // already loaded
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 12_000);
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/call-cards/${encodeURIComponent(cardId)}/workspace`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The server could not load this call.");
      if (!body.card) throw new Error("The server returned an incomplete call record.");
      setData(body as CallWorkspaceData);
    } catch (e) {
      if (controller.signal.aborted && !timedOut) return;
      setErr(
        timedOut
          ? "This call took too long to load. It has not been changed. Check your connection and try again."
          : `${(e as Error).message} The call has not been changed. Try again, or close this window.`
      );
    } finally {
      window.clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setLoading(false);
      }
    }
  }

  function close() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setLoading(false);
    setOpen(false);
    setErr(null);
  }

  return (
    <>
      {/* Whole-card click target. Not a native <button>: the card contains its
          own interactive controls (tel/mailto links, quick-edit popover), and
          nesting those inside a button is invalid HTML. A div with role=button
          + keyboard activation keeps it accessible without the nesting. */}
      <div
        role="button"
        tabIndex={0}
        onClick={launch}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return; // don't hijack inner controls
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            void launch();
          }
        }}
        className={`w-full text-left ${className}`}
        aria-label="Open call workspace"
      >
        {children}
      </div>

      {open && (
        <>
          {loading && (
            <div
              onClick={close}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            >
              <div
                className="mobile-tab-clearance rounded-md border border-border/55 bg-surface px-5 py-4 text-sm text-foreground shadow-2xl dark:border-white/10"
                role="status"
                aria-live="polite"
                aria-busy="true"
              >
                Loading call workspace…
              </div>
            </div>
          )}
          <ConfirmDialog
            open={Boolean(err)}
            title="The call workspace did not load"
            body={<p role="alert">{err}</p>}
            confirmLabel="Try again"
            cancelLabel="Close"
            onConfirm={() => void launch()}
            onCancel={close}
          />
          {data && <CallWorkspace data={data} onClose={close} />}
        </>
      )}
    </>
  );
}
