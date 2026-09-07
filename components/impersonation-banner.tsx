"use client";

import { useState } from "react";

/**
 * A permanent, unmissable marker that this is not your account.
 *
 * Deliberately loud and deliberately not dismissible. The realistic failure
 * here is not malice, it is an admin who forgot which tab they were in and
 * started typing notes into a customer's opportunity. The banner has to stay
 * in the way for as long as the session lasts.
 */
export function ImpersonationBanner({
  adminEmail,
  viewingEmail,
}: {
  adminEmail: string;
  viewingEmail: string;
}) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function stop() {
    setLeaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/impersonate", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        redirect?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error ??
            "The support session could not be closed. You are still viewing the customer account. Try again, then contact support if it continues."
        );
        setLeaving(false);
        return;
      }
      // Full navigation, not router.push: the session cookie just changed and
      // every cached server component belongs to the other account.
      window.location.href = data.redirect ?? "/admin/accounts";
    } catch {
      setError(
        "The server could not be reached. You are still viewing the customer account. Check your connection and try again."
      );
      setLeaving(false);
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-risk bg-risk px-4 py-2 text-sm text-on-status"
    >
      <span className="font-semibold uppercase tracking-wide">Support session</span>
      <span className="min-w-0 flex-1">
        You are viewing <strong>{viewingEmail}</strong> as {adminEmail}. This session is
        read-only: messages, account settings, billing, and customer data cannot be changed.
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={leaving}
        aria-describedby={error ? "support-session-exit-error" : undefined}
        className="min-h-11 rounded-md bg-white/95 px-4 py-2 font-semibold text-risk transition-colors hover:bg-white disabled:opacity-60"
      >
        {leaving ? "Returning…" : "Return to my account"}
      </button>
      {error && (
        <p id="support-session-exit-error" role="alert" className="w-full font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}
