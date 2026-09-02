"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";
import { ReasonDialog } from "@/components/confirm-dialog";

/**
 * Pass on an opportunity, with the reason the API requires.
 *
 * The Today and Review rows used to POST `{ action: "dismiss" }` with no
 * reason. The endpoint refuses that, so the button looked like it worked and
 * then failed. This asks for one line first, then sends it.
 */
export function PassButton({
  opportunityId,
  title,
  className = "btn-danger min-h-11 flex-1 text-xs lg:min-h-0 lg:flex-none",
  children = "Pass on this opportunity",
  onDone,
}: {
  opportunityId: string;
  title?: string | null;
  className?: string;
  children?: React.ReactNode;
  onDone?: () => void;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm(reason: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "dismiss", reason }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Could not pass on this opportunity." });
        return;
      }
      setOpen(false);
      onDone?.();
      push({
        message: `Passed on "${title ?? "this opportunity"}". It is archived, not deleted. Outreach and follow-ups have stopped.`,
        undo: {
          endpoint: `/api/opportunities/${opportunityId}/action`,
          body: { action: "restore" },
        },
      });
      router.refresh();
    } catch {
      push({ message: "Could not reach the server. Nothing was changed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => setOpen(true)}
        disabled={busy}
      >
        {children}
      </button>
      <ReasonDialog
        open={open}
        title="Pass on this opportunity"
        body="It will leave your active work. Emails already sent stay sent. Scheduled follow-ups and pending calls stop. The record is kept."
        placeholder="Too small, wrong trade, outside our area"
        confirmLabel="Pass on this opportunity"
        danger
        busy={busy}
        onConfirm={(reason) => void confirm(reason)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
