"use client";

/**
 * Connect Google Inbox.
 *
 * The customer's entire email setup is this one button. They sign in with
 * Google and the platform can then send outreach from their address, read the
 * replies back, and show the whole conversation in the app. There is nothing
 * to copy, paste, or verify.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface InboxConnection {
  connected: boolean;
  email: string | null;
  status: string;
  lastError: string | null;
  /** False when the platform has no OAuth app configured at all. */
  available: boolean;
}

export function GoogleInboxCard({ initial }: { initial: InboxConnection }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // "revoked" means a row exists but the grant is gone, usually because the
  // user removed access from their Google account. Treated as disconnected so
  // the UI asks for a reconnect instead of claiming everything is fine.
  const live = initial.connected && initial.status !== "revoked";

  async function disconnect() {
    if (
      !window.confirm(
        "Disconnect this inbox? Outreach stops sending and replies stop syncing until you reconnect. Nothing is deleted from your Gmail."
      )
    )
      return;
    setBusy(true);
    try {
      await fetch("/api/integrations/gmail/disconnect", { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-foreground">Your email</p>
          <p className="mt-0.5 text-sm text-slate-600">
            Outreach sends from your address, and replies come straight back into the
            record.
          </p>
        </div>
        <span
          className={`badge shrink-0 ${
            live ? "bg-pursue/15 text-pursue" : "bg-review/15 text-review"
          }`}
        >
          {live ? "Connected" : "Not connected"}
        </span>
      </div>

      {live ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Connected as</p>
          <p className="num mt-1 break-all text-sm font-medium text-foreground">
            {initial.email ?? "your Google account"}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-700">
          Nothing to set up. Click the button, sign in with Google, and you are done.
        </p>
      )}

      {initial.status === "revoked" && (
        <p className="text-sm text-risk">
          Access to this inbox was removed in your Google account. Reconnect to start
          sending and receiving again.
        </p>
      )}
      {initial.lastError && initial.status !== "revoked" && (
        <p className="text-xs text-risk">Last error: {initial.lastError}</p>
      )}

      {!initial.available && (
        <p className="text-sm text-risk">
          Email is not available on this deployment yet. Nothing you can fix from here.
        </p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        {initial.available && (
          <a href="/api/integrations/gmail/connect" className="btn-primary text-xs">
            {live ? "Reconnect Google Inbox" : "Connect Google Inbox"}
          </a>
        )}
        {live && (
          <button className="btn-ghost text-xs" onClick={disconnect} disabled={busy}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
    </div>
  );
}
