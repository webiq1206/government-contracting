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
  const [parts, setParts] = useState(() => partsFor(new Date()));

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
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/55 pb-8 dark:border-white/10">
      <div className="min-w-0">
        <p className="eyebrow-gold">{parts.date}</p>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.14em] text-gold-text">
          {settingUp ? "Getting started" : "Needs your attention"}
        </p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-foreground sm:text-4xl lg:text-[2.75rem]">
          {settingUp ? (
            <>
              {parts.greeting}.{" "}
              <span className="text-muted-foreground">
                {setupRemaining} step{setupRemaining === 1 ? "" : "s"} to go.
              </span>
            </>
          ) : clear ? (
            <>
              {parts.greeting}.{" "}
              <span className="text-muted-foreground">You are clear for now.</span>
            </>
          ) : (
            <>
              {/*
                "Decisions" was wrong as a name for this queue and the audit
                said so: it holds calls, deadlines, approvals and compliance
                renewals, and none of those is a decision. The ledger already
                phrases it correctly for the sidebar and the Guide panel, and
                this headline -- the largest text on the busiest screen -- was
                the one place still using the old word.
              */}
              <span className="num">{actionCount}</span>{" "}
              {actionCount === 1 ? "action needs" : "actions need"} you.
            </>
          )}
        </h1>
        {settingUp ? (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Finish the setup below and Brost Co starts pulling federal opportunities, scoring
            them against your company, and lining up the work that needs you. Nothing appears
            here until that is connected.
          </p>
        ) : !clear ? (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {parts.greeting}. Work the queue in order. Each row opens the exact place to finish
            the task.
          </p>
        ) : null}
      </div>
      {!clear && (
        <div className="border border-gold/35 bg-surface-raised px-4 py-3 text-right">
          <p className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
            Live queue
          </p>
          <p className="mt-1 font-display text-2xl text-gold-text">
            <span className="num">{actionCount}</span>
          </p>
        </div>
      )}
    </div>
  );
}
