"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface SubNotesProps {
  subId: string;
  initialNotes: string | null;
}

/** Permanent notes editor for a subcontractor. POSTs to /api/subs/[id]/notes. */
export function SubNotes({ subId, initialNotes }: SubNotesProps) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/subs/${subId}/notes`, {
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

  return (
    <div className="space-y-2">
      <textarea
        className="input min-h-[140px] resize-y font-normal"
        placeholder="Permanent notes — update after every call…"
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
        {status && <span className="text-xs text-pursue">{status}</span>}
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>
    </div>
  );
}
