"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UnsavedGuard } from "./unsaved-guard";

interface SubNotesProps {
  subId: string;
  initialNotes: string | null;
}

/** Permanent notes editor for a subcontractor. POSTs to /api/subs/[id]/notes. */
export function SubNotes({ subId, initialNotes }: SubNotesProps) {
  const router = useRouter();
  const pending = useRef(false);
  const [savedNotes, setSavedNotes] = useState(initialNotes ?? "");
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/subs/${subId}/notes`, {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      setSavedNotes(notes);
      setStatus("Saved");
      router.refresh();
    } catch {
      setError("The save was not confirmed. Your notes are still here. Check the record before trying again.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <UnsavedGuard when={notes !== savedNotes} />
      <textarea
        aria-label="Subcontractor notes"
        className="input min-h-[140px] resize-y font-normal"
        placeholder="Permanent notes. Update after every call…"
        value={notes}
        onChange={(e) => {
          setNotes(e.target.value);
          setStatus(null);
        }}
      />
      <div className="flex items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save notes"}
        </button>
        {status && <span role="status" className="text-xs text-pursue">{status}</span>}
        {error && <span role="alert" className="text-xs text-risk">{error}</span>}
      </div>
    </div>
  );
}
