"use client";

import { useEffect, useState } from "react";

/**
 * A live, ticking countdown to the bid deadline that also shows the exact due
 * date + time (in the viewer's timezone). Updates every second. Turns amber
 * inside 48 hours and red once overdue.
 */
export function DeadlineCountdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!deadline) {
    return <span className="text-sm text-slate-500">No deadline on file</span>;
  }
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) {
    return <span className="text-sm text-slate-500">—</span>;
  }

  const ms = target - now;
  const overdue = ms <= 0;
  const soon = !overdue && ms <= 48 * 3_600_000;

  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  const secs = Math.floor((abs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${pad(hours)}h`);
  parts.push(`${pad(mins)}m`);
  parts.push(`${pad(secs)}s`);
  const remaining = parts.join(" ");

  const exact = new Date(deadline).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const color = overdue ? "text-risk" : soon ? "text-review" : "text-foreground";

  return (
    <span className="block" suppressHydrationWarning>
      <span className={`num text-lg font-semibold tabular-nums ${color}`}>
        {overdue ? `Overdue by ${remaining}` : remaining}
      </span>
      <span className="mt-0.5 block text-xs text-slate-500">Due {exact}</span>
    </span>
  );
}
