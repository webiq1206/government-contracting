"use client";

import { useEffect } from "react";

/**
 * Dashboard-wide error boundary. Catches any server-render or client crash
 * under (dash) and gives the operator a plain-English recovery path instead
 * of the framework's generic error screen.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render error:", error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-3xl">⚠️</p>
      <h1 className="font-display text-2xl font-semibold text-foreground">
        Something went wrong loading this page.
      </h1>
      <p className="max-w-md text-sm text-slate-500">
        This is usually a brief database hiccup. Your data is safe. Try again,
        and if it keeps happening check the Agents page for errors.
      </p>
      <div className="mt-2 flex gap-2">
        <button onClick={() => reset()} className="btn-primary">
          Try again
        </button>
        <a href="/pipeline" className="btn-ghost">
          Back to Pipeline
        </a>
      </div>
    </div>
  );
}
