"use client";

import { useRef, useState } from "react";
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
  className = "btn-danger coarse:min-h-11 flex-1 text-xs lg:flex-none",
  children = "Pass on this opportunity",
  onDone,
  role,
}: {
  opportunityId: string;
  title?: string | null;
  className?: string;
  children?: React.ReactNode;
  onDone?: () => void;
  role?: "menuitem";
}) {
  const router = useRouter();
  const requestPending = useRef(false);
  const { push } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirm(reason: string) {
    if (requestPending.current) return;
    requestPending.current = true;
    setBusy(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/action`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
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
      push({ message: "The change was not confirmed. Check the opportunity before trying again." });
    } finally {
      requestPending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        role={role}
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
