"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** POST-only sign-out control for places that cannot use the main navigation. */
export function LogoutControl({ className = "" }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(body.error ?? "Your session could not be revoked. Try again before leaving.");
        return;
      }
      router.push("/login");
      router.refresh();
    } catch {
      setError("The sign-out request could not reach the server. Check your connection and retry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button type="button" onClick={signOut} disabled={busy} className={className}>
        {busy ? "Signing out" : "Sign out"}
      </button>
      {error && (
        <span role="alert" className="max-w-xs text-right text-xs leading-relaxed text-risk">
          {error}
        </span>
      )}
    </span>
  );
}
