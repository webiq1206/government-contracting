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
}: {
  clear: boolean;
  actionCount: number;
}) {
  const [parts, setParts] = useState(() => partsFor(new Date()));

  useEffect(() => {
    setParts(partsFor(new Date()));
  }, []);

  const estimated = Math.max(5, actionCount * 6);

  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-8">
      <div className="min-w-0">
        <p className="eyebrow-gold">{parts.date}</p>
        <h1 className="mt-3 font-display text-3xl leading-tight text-white sm:text-4xl lg:text-[2.75rem]">
          {parts.greeting}.{" "}
          {clear ? (
            <span className="text-white/70">You are clear for now.</span>
          ) : (
            <span>Here is what needs you.</span>
          )}
        </h1>
      </div>
      {!clear && (
        <div className="border border-white/15 px-3 py-2 text-right">
          <p className="num text-lg text-gold">{estimated}</p>
          <p className="text-[0.65rem] uppercase tracking-[0.14em] text-white/40">
            minutes estimated
          </p>
        </div>
      )}
    </div>
  );
}
