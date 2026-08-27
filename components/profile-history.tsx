"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { ProfileVersion } from "@/lib/profile-history";

/**
 * Every version the profile has had, and a way back to one.
 *
 * The versions were always on disk and never shown, so a bad edit could only
 * be undone by remembering what was there, and "who widened the service area
 * in March" had nowhere to be answered from on the record that scoring,
 * eligibility and every generated document treat as the truth.
 *
 * Restoring goes forward: the earlier profile is published as a new version,
 * so the mistake and the correction are both on file and both say who did it.
 */
export function ProfileHistory({
  versions,
  canRestore,
}: {
  versions: ProfileVersion[];
  canRestore: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<ProfileVersion | null>(null);

  async function restore(v: ProfileVersion) {
    setAsking(null);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/profile/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: v.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not restore that version.");
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (versions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No saved versions yet. Every save from here on is kept, with what changed.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-risk">{error}</p>}
      <ol className="space-y-3">
        {versions.map((v) => (
          <li key={v.id} className="card">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">
                Version {v.version}
                {v.active && (
                  <span className="badge ml-2 bg-pursue/15 text-pursue-strong">In use</span>
                )}
              </p>
              <p className="text-xs text-slate-500">
                {v.updatedAt.slice(0, 10)}
                {v.updatedBy ? ` · ${v.updatedBy}` : " · account since removed"}
              </p>
            </div>
            <p className="mt-1 text-xs text-slate-600">{v.summary}</p>

            {v.changes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {v.changes.slice(0, 6).map((c) => (
                  <li
                    key={c.field}
                    className={`text-xs leading-relaxed ${
                      /*
                       * A change that alters what gets found or priced reads
                       * differently from a change of address, and the list is
                       * sorted so those come first.
                       */
                      c.material ? "text-foreground" : "text-slate-500"
                    }`}
                  >
                    {c.summary}
                  </li>
                ))}
                {v.changes.length > 6 && (
                  <li className="text-xs text-slate-500">
                    and {v.changes.length - 6} more
                  </li>
                )}
              </ul>
            )}

            {canRestore && !v.active && (
              <button
                className="btn-ghost mt-2 text-xs"
                onClick={() => setAsking(v)}
                disabled={busy}
              >
                Put this version back
              </button>
            )}
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={asking !== null}
        title={`Restore version ${asking?.version ?? ""}?`}
        body="This publishes that profile again as a new version. Nothing is erased: the current version stays in the history, so you can come back to it the same way."
        confirmLabel="Restore it"
        busy={busy}
        onConfirm={() => asking && void restore(asking)}
        onCancel={() => setAsking(null)}
      />
    </div>
  );
}
