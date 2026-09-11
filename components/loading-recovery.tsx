"use client";

import { useEffect, useState } from "react";

/** A stalled server stream must not leave an unexplained skeleton forever. */
export function LoadingRecovery({ label = "Loading your workspace" }: { label?: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);

  return <div className="shrink-0 px-5 py-3 text-sm" role="status" aria-live="polite">
    <p className="font-medium">{slow ? "This page is taking longer than expected." : label}</p>
    {slow && <div className="mt-2 flex flex-wrap items-center gap-3">
      <p>Your connection or the server may be delayed.</p>
      <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>Reload this page</button>
    </div>}
  </div>;
}
