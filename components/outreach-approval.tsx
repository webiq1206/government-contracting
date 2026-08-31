"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface OutreachDraftData {
  id: string;
  domain: string;
  subject: string | null;
  body: string | null;
}

/**
 * One pending outreach draft with an editable subject/body and Approve / Reject
 * controls. Approving is the human gate: nothing is sent until a person clicks it
 * (and even then, sending is a separate step). The operator can tweak the copy
 * before approving.
 */
export function OutreachApprovalCard({
  draft,
  nextHref = null,
  doneHref,
}: {
  draft: OutreachDraftData;
  /**
   * The next draft in the queue.
   *
   * Approving takes this one out of the queue, so staying put leaves an
   * approved draft on screen and the reader to go and find the next. Null on
   * the last one, which falls back to `doneHref`.
   */
  nextHref?: string | null;
  /** Where to land when there is no next draft. Omit outside a queue. */
  doneHref?: string;
}) {
  const router = useRouter();
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body ?? "");
  const [busy, setBusy] = useState<null | "approve" | "reject">(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/authority/outreach/${draft.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "approve" ? { action, subject, body } : { action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      if (nextHref || doneHref) router.push(nextHref ?? doneHref!);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{draft.domain}</p>
        <span className="badge bg-review/15 text-review">Awaiting approval</span>
      </div>
      <label className="block">
        <span className="label mb-1 block">Subject</span>
        <input
          className="input w-full text-sm"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>
      <label className="block">
        <span className="label mb-1 block">Message</span>
        <textarea
          className="input h-40 w-full text-sm"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <p className="text-xs text-slate-500">
        Review and edit the copy, then approve. Nothing is sent automatically: approval marks it
        ready so you stay in control and compliant with anti-spam rules.
      </p>
      <div className="flex items-center gap-2">
        <button
          className="btn-primary text-sm"
          onClick={() => act("approve")}
          disabled={busy !== null}
          aria-busy={busy === "approve"}
        >
          {busy === "approve" ? "Approving…" : nextHref ? "Approve & next" : "Approve"}
        </button>
        <button
          className="btn-ghost text-sm"
          onClick={() => act("reject")}
          disabled={busy !== null}
          aria-busy={busy === "reject"}
        >
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </button>
      </div>
      {error && <p className="text-xs text-risk">{error}</p>}
    </div>
  );
}
