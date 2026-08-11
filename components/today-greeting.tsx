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
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-gold">
          Needs your attention
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-white sm:text-4xl lg:text-[2.75rem]">
          {clear ? (
            <>
              {parts.greeting}.{" "}
              <span className="text-white/70">You are clear for now.</span>
            </>
          ) : (
            <>
              <span className="num">{actionCount}</span>{" "}
              {actionCount === 1 ? "decision" : "decisions"}.{" "}
              <span className="num">{estimated}</span> minutes.
            </>
          )}
        </h1>
        {!clear && (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/50">
            {parts.greeting}. Work the queue in order. Each row opens the exact place to finish
            the task.
          </p>
        )}
      </div>
      {!clear && (
        <div className="border border-gold/35 bg-[#11120f] px-4 py-3 text-right">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-white/40">
            Live queue
          </p>
          <p className="mt-1 font-display text-2xl text-gold">
            <span className="num">{actionCount}</span>
          </p>
        </div>
      )}
    </div>
  );
}
