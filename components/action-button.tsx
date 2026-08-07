"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ActionButtonProps {
  endpoint: string;
  method?: "POST" | "GET";
  body?: Record<string, unknown>;
  className?: string;
  children: React.ReactNode;
  confirm?: string;
  /** Called with the JSON response on success. */
  onDone?: (data: unknown) => void;
  refresh?: boolean;
  /**
   * Short confirmation shown next to the button after success (e.g.
   * "Pursued, analysis started"). Says what happened AND what happens next,
   * so the operator is never left wondering whether the click worked.
   */
  successText?: string;
}

/** Generic button that calls an API route, shows a spinner, and refreshes the view. */
export function ActionButton({
  endpoint,
  method = "POST",
  body,
  className = "btn-ghost",
  children,
  confirm,
  onDone,
  refresh = true,
  successText,
}: ActionButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function go() {
    if (loading) return; // double-click guard
    if (confirm && !window.confirm(confirm)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      onDone?.(data);
      if (successText) {
        setDone(true);
        setTimeout(() => setDone(false), 6000);
      }
      if (refresh) router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button className={className} onClick={go} disabled={loading} aria-busy={loading}>
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
            Working…
          </span>
        ) : (
          children
        )}
      </button>
      {error && <span className="mt-1 text-xs text-risk">{error}</span>}
      {done && !error && (
        <span aria-live="polite" className="mt-1 text-xs text-pursue">
          ✓ {successText}
        </span>
      )}
    </span>
  );
}
