"use client";

import { useEffect, useState } from "react";

function partsFor(now: Date) {
  const date = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return { date };
}

export function TodayGreeting({
  clear,
  actionCount,
  setupRemaining = 0,
}: {
  clear: boolean;
  actionCount: number;
  setupRemaining?: number;
}) {
  const [parts, setParts] = useState({ date: "Today" });

  useEffect(() => {
    setParts(partsFor(new Date()));
  }, []);

  const settingUp = actionCount === 0 && setupRemaining > 0;

  return (
    <header className="pb-3">
      <p className="text-xs text-muted-foreground">{parts.date}</p>
      <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight">Today</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {settingUp
          ? `${setupRemaining} setup steps before your first opportunity.`
          : clear
            ? "You’re all caught up. We’ll keep watching for new work."
            : `${actionCount} ${actionCount === 1 ? "action needs" : "actions need"} your attention.`}
      </p>
    </header>
  );
}
