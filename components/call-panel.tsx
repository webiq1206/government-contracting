"use client";

/**
 * The active call, beside the queue rather than on top of it.
 *
 * The audit asks for a permanent split on desktop, and the reason is the
 * rhythm of the work: an operator making eight calls in a morning finishes one
 * and starts the next, and a dialog that closes and reopens between every pair
 * puts a full-screen transition in the middle of that. The queue stays where
 * it was, and the call changes beside it.
 *
 * Which call is open is a query parameter, so the back button works, a call is
 * a link somebody can send, and the mobile rule -- the call takes the screen
 * -- is a CSS class rather than a second implementation.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { CallWorkspace, type CallWorkspaceData } from "./call-workspace";

export function CallPanel({
  cardId,
  closeHref,
}: {
  cardId: string;
  closeHref: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<CallWorkspaceData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/call-cards/${cardId}/workspace`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError((body as { error?: string }).error ?? "Could not load this call.");
          return;
        }
        setData(body as CallWorkspaceData);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-sm text-center">
          <p className="text-sm font-medium text-risk">{error}</p>
          <p className="mt-1 text-xs text-slate-500">
            The card may have been completed or skipped since the list loaded.
          </p>
          <Link href={closeHref} className="btn-ghost mt-3 inline-flex text-sm">
            Back to the queue
          </Link>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-slate-500">Loading the call…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border/55 px-4 py-2 dark:border-white/10 lg:hidden">
        <Link href={closeHref} className="tap text-xs text-slate-500 hover:text-accent">
          Back to the queue
        </Link>
      </div>
      <div className="min-h-0 flex-1">
        <CallWorkspace
          data={data}
          variant="inline"
          onClose={() => {
            router.push(closeHref);
          }}
        />
      </div>
    </div>
  );
}
