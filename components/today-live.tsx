"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps the Today page trustworthy while it sits open:
 *  - polls a cheap state fingerprint every 60s; when it changes, shows a
 *    "New activity" pill (one click refreshes) instead of yanking rows
 *    around mid-read;
 *  - refreshes silently whenever the tab regains focus, so coming back from
 *    lunch never shows a stale morning list.
 */
export function TodayLive() {
  const router = useRouter();
  const [stale, setStale] = useState(false);
  const baseline = useRef<string | null>(null);

  useEffect(() => {
    let stopped = false;

    async function pulse(): Promise<string | null> {
      try {
        const res = await fetch("/api/today/pulse", { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as { fingerprint?: string };
        return data.fingerprint ?? null;
      } catch {
        return null; // offline/transient: never surface an error for a poll
      }
    }

    async function tick() {
      const fp = await pulse();
      if (stopped || fp == null) return;
      if (baseline.current == null) baseline.current = fp;
      else if (fp !== baseline.current) setStale(true);
    }

    void tick();
    const timer = setInterval(() => void tick(), 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // Fresh eyes deserve fresh data; re-baseline after the refresh.
        baseline.current = null;
        setStale(false);
        router.refresh();
        void tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  if (!stale) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[70] flex justify-center px-4">
      <button
        onClick={() => {
          baseline.current = null;
          setStale(false);
          router.refresh();
        }}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-pursue/50 bg-pursue-soft px-4 py-1.5 text-sm font-medium text-pursue-strong shadow-lg transition-colors hover:border-pursue"
      >
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-pursue" />
        New activity, refresh the list
      </button>
    </div>
  );
}
