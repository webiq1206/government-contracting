"use client";

/**
 * Soft, dismissible nudge when the current page has something needing the
 * operator. Uses the slim guide pulse endpoint so it stays cheap.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { openGuideWizard } from "@/components/guide-wizard";

const DISMISS_PREFIX = "brost.guide.nudge.dismissed:";

export function GuideNudge() {
  const pathname = usePathname();
  const [badge, setBadge] = useState(0);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const key = DISMISS_PREFIX + pathname;
    try {
      if (sessionStorage.getItem(key) === "1") {
        setHidden(true);
        return;
      }
    } catch {
      /* private mode */
    }

    (async () => {
      try {
        const res = await fetch(`/api/guide/pulse?path=${encodeURIComponent(pathname)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { badgeCount?: number; idle?: boolean };
        if (cancelled) return;
        const n = Number(data.badgeCount ?? 0);
        setBadge(n);
        setHidden(n <= 0 || Boolean(data.idle));
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (hidden || badge <= 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[66] flex justify-center px-4 md:top-4">
      <div className="pointer-events-auto flex max-w-md items-center gap-2 rounded-md border border-gold/40 bg-ink/95 px-3 py-1.5 text-sm text-white shadow-lg backdrop-blur">
        <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-gold" />
        <button
          type="button"
          className="min-w-0 flex-1 text-left font-medium text-white"
          onClick={() => openGuideWizard()}
        >
          {badge === 1 ? "1 action needs you here" : `${badge} actions need you here`}
          <span className="ml-1 font-normal text-white/45">Guide Me</span>
        </button>
        <button
          type="button"
          className="shrink-0 rounded px-1.5 text-xs text-white/45 hover:text-white"
          aria-label="Dismiss nudge"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_PREFIX + pathname, "1");
            } catch {
              /* ignore */
            }
            setHidden(true);
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
