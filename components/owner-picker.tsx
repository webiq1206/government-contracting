"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { describeOwner, type Owner } from "@/lib/domain/ownership";
import type { OwnableKind } from "@/lib/ownership";

/**
 * Whose this is, and how to change it.
 *
 * A select rather than a dialog. Assigning is the lightest decision on any of
 * these screens and it gets made twenty times a morning, so putting it behind
 * a confirmation would mean nobody uses it and the column stays empty, which
 * is the same as not having built it.
 *
 * "Unassigned" is the first option and a real choice, not a placeholder.
 * Work that was on somebody and is now on nobody is a state a team gets into,
 * and the alternative of forcing a name means the person who left stays on
 * forty records.
 */
export function OwnerPicker({
  kind,
  recordId,
  owner,
  members,
  viewerId,
  canAssign = true,
  compact = false,
}: {
  kind: OwnableKind;
  recordId: string;
  owner: Owner | null;
  /** Everybody in this organization. The API refuses anyone else. */
  members: Owner[];
  viewerId?: string;
  canAssign?: boolean;
  /** Inline in a row, rather than as a labelled field. */
  compact?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(owner?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canAssign) {
    return (
      <span className="text-xs text-muted-foreground">{describeOwner(owner, viewerId)}</span>
    );
  }

  async function change(next: string) {
    const previous = value;
    setValue(next);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/records/${kind}/${recordId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeId: next || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        // Back to what it was. A picker showing a name the server refused is
        // a screen telling four people something that is not true of the
        // fifth.
        setValue(previous);
        setError(data.error ?? "Could not change the owner.");
        return;
      }
      router.refresh();
    } catch {
      setValue(previous);
      setError("Could not reach the server. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const id = `owner-${kind}-${recordId}`;
  return (
    <span className={compact ? "inline-flex items-center gap-1" : "block"}>
      <label className={compact ? "sr-only" : "label mb-1 block"} htmlFor={id}>
        Owner
      </label>
      <select
        id={id}
        className={compact ? "input h-11 w-auto text-xs lg:h-7" : "input h-11 w-full lg:h-9"}
        value={value}
        disabled={busy}
        onChange={(e) => void change(e.target.value)}
      >
        <option value="">Unassigned</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.id === viewerId ? `${m.name} (you)` : m.name}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="ml-2 text-xs text-risk">
          {error}
        </span>
      )}
    </span>
  );
}
