"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function stop() {
    setLeaving(true);
    try {
      const res = await fetch("/api/admin/impersonate", { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { redirect?: string };
      // Full navigation, not router.push: the session cookie just changed and
      // every cached server component belongs to the other account.
      window.location.href = data.redirect ?? "/admin/accounts";
    } catch {
      setLeaving(false);
      router.refresh();
    }
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b-2 border-risk bg-risk px-4 py-2 text-sm text-white"
    >
      <span className="font-semibold uppercase tracking-wide">Support session</span>
      <span className="min-w-0 flex-1">
        You are signed in as <strong>{viewingEmail}</strong> ({adminEmail}). Outreach
        email is blocked and billing changes are refused.
      </span>
      <button
        type="button"
        onClick={stop}
        disabled={leaving}
        className="rounded-md bg-white/95 px-3 py-1 font-semibold text-risk transition-colors hover:bg-white disabled:opacity-60"
      >
        {leaving ? "Returning…" : "Return to my account"}
      </button>
    </div>
  );
}
