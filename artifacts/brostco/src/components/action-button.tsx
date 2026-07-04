import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

interface ActionButtonProps {
  endpoint: string;
  method?: "POST" | "GET" | "PATCH";
  body?: Record<string, unknown>;
  className?: string;
  children: ReactNode;
  confirm?: string;
  onDone?: (data: unknown) => void;
  invalidateKeys?: string[][];
}

export function ActionButton({
  endpoint,
  method = "POST",
  body,
  className = "btn-ghost",
  children,
  confirm: confirmMsg,
  onDone,
  invalidateKeys,
}: ActionButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function go() {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      onDone?.(data);
      if (invalidateKeys) {
        for (const key of invalidateKeys) {
          qc.invalidateQueries({ queryKey: key });
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col">
      <button className={className} onClick={go} disabled={loading}>
        {loading ? "..." : children}
      </button>
      {error && <span className="mt-1 text-xs text-risk">{error}</span>}
    </span>
  );
}
