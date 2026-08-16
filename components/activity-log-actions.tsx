"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toaster";

/**
 * The action row above the activity timeline: add a note or log a call
 * without leaving the feed. The timeline had been read-only, which meant the
 * record of what happened could never include the things that happened off
 * the platform (a hallway conversation, a call made from a cell phone).
 * One tap opens an inline composer; saving writes a communications row the
 * timeline picks up on refresh.
 */
export function ActivityLogActions({ opportunityId }: { opportunityId: string }) {
  const router = useRouter();
  const { push } = useToast();
  const [kind, setKind] = useState<"note" | "call" | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!kind || !text.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/log`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, body: text }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        push({ message: data.error ?? "Could not save that." });
        return;
      }
      push({ message: kind === "call" ? "Call logged." : "Note added." });
      setText("");
      setKind(null);
      router.refresh();
    } catch {
      push({ message: "Network error; nothing was saved." });
    } finally {
      setSaving(false);
    }
  }

  if (kind === null) {
    return (
      <div className="flex flex-wrap gap-2">
        <button className="btn-ghost text-xs" onClick={() => setKind("note")}>
          ✎ Add note
        </button>
        <button className="btn-ghost text-xs" onClick={() => setKind("call")}>
          ☏ Log a call
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        autoFocus
        className="input min-h-[80px] w-full resize-y font-normal"
        placeholder={
          kind === "call"
            ? "Who you spoke to and what they said, e.g. “Called Rivera, they can start in March, sending W-9 tomorrow.”"
            : "Anything worth keeping on this record."
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <button
          className="btn-primary text-xs"
          onClick={save}
          disabled={saving || !text.trim()}
        >
          {saving ? "Saving…" : kind === "call" ? "Log the call" : "Save note"}
        </button>
        <button
          className="btn-ghost text-xs"
          onClick={() => {
            setKind(null);
            setText("");
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
