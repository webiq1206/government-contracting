"use client";

import { useEffect, useState } from "react";

function partsFor(now: Date) {
  const hour = now.getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const date = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();
  return { greeting, date };
}

export function TodayGreeting({
  clear,
  actionCount,
  setupRemaining = 0,
}: {
  clear: boolean;
  actionCount: number;
  /**
   * Setup steps still outstanding. A brand-new account has nothing in its
   * queue but plenty to do, and the queue framing ("work the queue in order")
   * read as though the product were broken. Setup gets its own state.
   */
  setupRemaining?: number;
}) {
  // A visitor's date and timezone are available only after mounting.
  const [parts, setParts] = useState({ greeting: "Welcome back", date: "TODAY" });

  useEffect(() => {
    setParts(partsFor(new Date()));
  }, []);

  // No time estimate here on purpose. It used to read "N decisions. M
  // minutes.", where M was only ever actionCount * 6: a constant wearing the
  // costume of a measurement, printed to the minute. On a real queue that
  // rendered as "2556 minutes", which is both invented and demoralising.
  // The count is the honest number; the queue below is already in the order
  // to work it.
  // Nothing to work yet, but setup is unfinished: the honest headline is the
  // setup, not an empty queue.
  const settingUp = actionCount === 0 && setupRemaining > 0;

  return (
    <header className="flex items-center justify-between gap-4 pb-4">
      <div>
        <p className="text-xs text-muted-foreground">{parts.date}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {settingUp ? `${setupRemaining} setup steps before your first opportunity.` : clear ? "You’re all caught up. We’ll keep watching for new work." : `${actionCount} ${actionCount === 1 ? "action needs" : "actions need"} your attention.`}
        </p>
      </div>
    </header>
  );
}
