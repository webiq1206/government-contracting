"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useDraft } from "@/lib/use-draft";
import { DraftOffer, SaveStatus } from "@/components/save-status";

/**
 * Free-form operator notes on an opportunity, with an optional AI "tidy" that
 * cleans up rough notes for readability. Tidy returns a preview the operator
 * accepts or discards, it never overwrites saved notes on its own, and only a
 * Save writes to the record.
 *
 * The notes live on the device as they are typed. This is where somebody
 * writes up a call while it is still in their head, and the old version held
 * that text in React state and nowhere else: a failed save, or a click on the
 * sidebar, and it was gone with a small red "Save failed" as the only trace.
 */
export function OpportunityNotes({
  opportunityId,
  initialNotes,
}: {
  opportunityId: string;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const server = initialNotes ?? "";
  const [notes, setNotes] = useState(server);
  const [tidying, setTidying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When set, an AI-cleaned version is awaiting the operator's accept/discard.
  const [preview, setPreview] = useState<string | null>(null);

  /*
   * Throws on a refusal rather than reporting it, because the retry has to be
   * able to tell "the server said no" from "the request never arrived", and a
   * function that returns quietly on both looks like success to a caller.
   */
  const send = useCallback(
    async (value: string) => {
      const res = await fetch(`/api/opportunities/${opportunityId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "The server would not take it.");
      router.refresh();
    },
    [opportunityId, router]
  );

  const draft = useDraft({
    scope: "opportunity-notes",
    id: opportunityId,
    value: notes,
    serverValue: server,
    onRestore: setNotes,
    save: send,
  });

  async function tidy() {
    if (!notes.trim()) {
      setError("Write some notes first, then tidy them.");
      return;
    }
    setTidying(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/notes/tidy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not tidy the notes.");
        return;
      }
      setPreview(data.tidied ?? "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTidying(false);
    }
  }

  function acceptPreview() {
    if (preview != null) {
      setNotes(preview);
      setPreview(null);
      setStatus("Applied, review and Save to keep it.");
    }
  }

  return (
    <div className="space-y-2">
      {preview != null ? (
        <div className="space-y-2">
          <p className="label text-accent-strong">AI-tidied version, review before applying</p>
          <div className="max-h-64 overflow-y-auto rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm whitespace-pre-wrap text-slate-800">
            {preview}
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-primary text-xs" onClick={acceptPreview}>
              Use this
            </button>
            <button className="btn-ghost text-xs" onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
        </div>
      ) : (
        <>
        {draft.offered != null && (
          <DraftOffer
            draft={draft.offered}
            onUse={draft.useOffered}
            onDiscard={draft.discardOffered}
          />
        )}
        <textarea
          className="input min-h-[120px] resize-y font-normal"
          placeholder="Call takeaways, reminders, strategy… anything worth keeping on this opportunity."
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setStatus(null);
          }}
        />
        </>
      )}

      {preview == null && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="btn-primary text-xs"
            onClick={draft.saveNow}
            disabled={draft.state === "saving"}
          >
            {draft.state === "saving" ? "Saving…" : "Save notes"}
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={tidy}
            disabled={tidying || !notes.trim()}
            title="Have AI clean up and organize your notes"
          >
            {tidying ? "Tidying…" : "✨ Tidy with AI"}
          </button>
          <SaveStatus
            state={draft.state}
            attempt={draft.attempt}
            retryInMs={draft.retryInMs}
            reason={draft.reason}
            onRetry={draft.saveNow}
          />
          {status && <span className="text-xs text-pursue">{status}</span>}
          {/* Tidy's own failures. The save has its own line above. */}
          {error && <span className="text-xs text-risk">{error}</span>}
        </div>
      )}
    </div>
  );
}
