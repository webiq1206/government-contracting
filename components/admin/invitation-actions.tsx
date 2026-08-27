"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";

/**
 * Re-send and revoke, on one invitation.
 *
 * Re-sending issues a new link and kills the old one, so the buttons are
 * labelled with what happens rather than with the verb: an admin should not
 * have to know that detail to predict the outcome.
 */
export function InvitationActions({
  id,
  email,
  canResend,
}: {
  id: string;
  email: string;
  canResend: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);

  async function run(action: "resend" | "revoke") {
    setAsking(false);
    setBusy(action);
    setNote(null);
    try {
      const res = await fetch(`/api/admin/invitations/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!res.ok) {
        setNote({ ok: false, text: data.error ?? "That did not work." });
        return;
      }
      setNote({ ok: true, text: data.message ?? "Done." });
      router.refresh();
    } catch {
      setNote({ ok: false, text: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  if (!canResend) return null;

  return (
    <>
      <ConfirmDialog
        open={asking}
        title={`Withdraw the invitation to ${email}?`}
        body="The link stops working. They can be invited again later; nothing about the account changes."
        confirmLabel="Withdraw it"
        danger
        busy={busy === "revoke"}
        onConfirm={() => void run("revoke")}
        onCancel={() => setAsking(false)}
      />
    <div className="space-y-1">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-secondary px-2 py-1 text-xs"
          disabled={busy !== null}
          onClick={() => run("resend")}
        >
          {busy === "resend" ? "Sending…" : "Send a new link"}
        </button>
        <button
          type="button"
          className="btn-ghost px-2 py-1 text-xs text-risk"
          disabled={busy !== null}
          onClick={() => setAsking(true)}
        >
          {busy === "revoke" ? "Withdrawing…" : "Withdraw"}
        </button>
      </div>
      {note && (
        <p className={`text-xs ${note.ok ? "text-pursue" : "text-risk"}`}>{note.text}</p>
      )}
    </div>
    </>
  );
}
