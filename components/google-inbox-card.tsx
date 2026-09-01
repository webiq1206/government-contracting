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
import { ConfirmDialog } from "@/components/confirm-dialog";

export interface InboxConnection {
  connected: boolean;
  email: string | null;
  status: string;
  lastError: string | null;
  /** False when the platform has no OAuth app configured at all. */
  available: boolean;
  /** The chosen "Send mail as" address, or null to use the Google account. */
  sendAs: string | null;
  /** Set when the chosen address is no longer verified at Google. */
  sendAsProblem: string | null;
}

interface SendAsOption {
  address: string;
  displayName: string | null;
  isPrimary: boolean;
}

export function GoogleInboxCard({
  initial,
  canManage = true,
}: {
  initial: InboxConnection;
  canManage?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [options, setOptions] = useState<SendAsOption[] | null>(null);
  const [choice, setChoice] = useState(initial.sendAs ?? "");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const sending = initial.sendAs ?? initial.email;

  /**
   * Google is asked only when the operator opens the picker. It is the
   * authority on which addresses are legal, but it is also a network call on
   * a settings page that most visits never touch.
   */
  async function openPicker() {
    setEditing(true);
    setSaveError(null);
    if (options) return;
    setLoadError(null);
    try {
      const res = await fetch("/api/integrations/gmail/sender");
      const data = (await res.json()) as {
        options?: SendAsOption[];
        sendAs?: string | null;
        error?: string | null;
      };
      if (!res.ok) {
        setLoadError(data.error ?? "Your verified addresses could not be loaded.");
        return;
      }
      setOptions(data.options ?? []);
      setChoice(data.sendAs ?? "");
      if (data.error) setLoadError(data.error);
    } catch {
      setLoadError("Your verified addresses could not be loaded. Check your connection and try again.");
    }
  }

  async function saveSender() {
    setBusy(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/integrations/gmail/sender", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: choice || null }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setSaveError(data.error ?? "That address could not be saved.");
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // "revoked" means a row exists but the grant is gone, usually because the
  // user removed access from their Google account. Treated as disconnected so
  // the UI asks for a reconnect instead of claiming everything is fine.
  const live = initial.connected && initial.status !== "revoked";

  async function disconnect() {
    setAsking(false);
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
      <ConfirmDialog
        open={asking}
        title="Disconnect this inbox?"
        body="Outreach stops sending and replies stop syncing until you reconnect. Nothing is deleted from your Gmail."
        confirmLabel="Disconnect it"
        danger
        busy={busy}
        onConfirm={() => void disconnect()}
        onCancel={() => setAsking(false)}
      />
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
          {live ? "Working" : "Not connected"}
        </span>
      </div>

      {live ? (
        <div className="rounded-md border border-border bg-muted/40 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-slate-500">Sending as</p>
              <p className="num mt-1 break-all text-sm font-medium text-foreground">
                {sending ?? "your Google account"}
              </p>
              {initial.sendAs && initial.email && initial.sendAs !== initial.email && (
                <p className="mt-1 text-xs text-slate-600">
                  Signed in as {initial.email}. Replies to {initial.sendAs} have to arrive
                  in that mailbox, which is the one the app reads.
                </p>
              )}
            </div>
            {canManage && !editing && (
              <button className="btn-ghost shrink-0 text-xs" onClick={() => void openPicker()}>
                Change
              </button>
            )}
          </div>

          {initial.sendAsProblem && !editing && (
            <p className="mt-2 text-xs text-risk">{initial.sendAsProblem}</p>
          )}

          {editing && (
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <label className="block text-xs font-medium text-foreground" htmlFor="send-as">
                Send email from
              </label>
              {options === null && !loadError && (
                <p className="text-xs text-slate-600">Loading your verified addresses…</p>
              )}
              {options !== null && (
                <select
                  id="send-as"
                  className="input w-full text-sm"
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">{initial.email ?? "The connected Google account"}</option>
                  {options
                    .filter((o) => o.address !== initial.email)
                    .map((o) => (
                      <option key={o.address} value={o.address}>
                        {o.address}
                      </option>
                    ))}
                </select>
              )}
              <p className="text-xs text-slate-600">
                Only addresses Google has verified for this mailbox can be used. Add one in
                Gmail under Settings, Accounts, Send mail as.
              </p>
              <p className="text-xs text-slate-600">
                Replies are read from the mailbox you signed in with, so anything sent to
                the address you choose has to be delivered there. Send yourself a test and
                reply to it before you rely on it.
              </p>
              {loadError && <p className="text-xs text-risk">{loadError}</p>}
              {saveError && <p className="text-xs text-risk">{saveError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  className="btn-primary text-xs"
                  disabled={busy || options === null}
                  onClick={() => void saveSender()}
                >
                  {busy ? "Saving…" : "Save"}
                </button>
                <button
                  className="btn-ghost text-xs"
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setChoice(initial.sendAs ?? "");
                    setSaveError(null);
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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
          <button className="btn-ghost text-xs" onClick={() => setAsking(true)} disabled={busy}>
            {busy ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
    </div>
  );
}
