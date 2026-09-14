"use client";

import { useState } from "react";
import Link from "next/link";

type Target = { id: string; provider: string; label: string; personal: boolean };

const NAME: Record<string, string> = {
  google_drive: "Google Drive",
  microsoft_onedrive: "OneDrive",
  dropbox: "Dropbox",
  box: "Box",
};

/**
 * Save this record's stored documents into a connected file storage.
 * Offers the connection only when one exists; otherwise points at where to
 * connect one, from the place somebody is looking at the documents.
 */
export function SaveToStorage({ opportunityId, targets }: { opportunityId: string; targets: Target[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (targets.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Want these in your Drive, OneDrive, Dropbox or Box?{" "}
        <Link href="/settings/integrations#apps" className="underline">Connect a storage app</Link>.
      </p>
    );
  }

  async function save(t: Target) {
    setBusy(t.id);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/documents/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId: t.id }),
        signal: AbortSignal.timeout(180_000),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; saved?: { skipped?: boolean }[]; failed?: { name: string; error: string }[] };
      if (!res.ok) {
        setError(data.error ?? "That did not save.");
        return;
      }
      const fresh = (data.saved ?? []).filter((s) => !s.skipped).length;
      const already = (data.saved ?? []).length - fresh;
      const failed = data.failed ?? [];
      setMessage(
        `${fresh} saved to ${NAME[t.provider] ?? t.provider}${already ? `, ${already} already there` : ""}${failed.length ? `. Not saved: ${failed.map((f) => f.name).join(", ")}` : "."}`
      );
    } catch {
      setError("The save was not confirmed. Check the folder before trying again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((t) => (
          <button key={t.id} type="button" className="btn-ghost min-h-11 text-sm" disabled={busy != null} onClick={() => void save(t)}>
            {busy === t.id ? "Saving" : `Save to ${NAME[t.provider] ?? t.provider}${t.personal ? " (yours)" : ""}`}
          </button>
        ))}
      </div>
      {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
      {error && <p role="alert" className="text-xs text-risk">{error}</p>}
    </div>
  );
}
