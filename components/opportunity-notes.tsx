"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Free-form operator notes on an opportunity, with an optional AI "tidy" that
 * cleans up rough notes for readability. Tidy returns a preview the operator
 * accepts or discards, it never overwrites saved notes on its own, and only a
 * Save writes to the record.
 */
export function OpportunityNotes({
  opportunityId,
  initialNotes,
}: {
  opportunityId: string;
  initialNotes: string | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // When set, an AI-cleaned version is awaiting the operator's accept/discard.
  const [preview, setPreview] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setStatus("Saved");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
        <textarea
          className="input min-h-[120px] resize-y font-normal"
          placeholder="Call takeaways, reminders, strategy… anything worth keeping on this opportunity."
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setStatus(null);
          }}
        />
      )}

      {preview == null && (
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-primary text-xs" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save notes"}
          </button>
          <button
            className="btn-ghost text-xs"
            onClick={tidy}
            disabled={tidying || !notes.trim()}
            title="Have AI clean up and organize your notes"
          >
            {tidying ? "Tidying…" : "✨ Tidy with AI"}
          </button>
          {status && <span className="text-xs text-pursue">{status}</span>}
          {error && <span className="text-xs text-risk">{error}</span>}
        </div>
      )}
    </div>
  );
}
