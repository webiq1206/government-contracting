"use client";

import { useEffect, useState } from "react";

interface PromoCountdownProps {
  endsAtIso: string;
  variant?: "light" | "dark";
}

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

function computeRemaining(endsAtIso: string): Remaining | null {
  const diff = new Date(endsAtIso).getTime() - Date.now();
  if (!Number.isFinite(diff) || diff <= 0) return null;
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function CountdownUnit({
  value,
  label,
  dark,
}: {
  value: string;
  label: string;
  dark: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span
        className={`num flex h-12 w-12 items-center justify-center border text-lg font-semibold sm:h-14 sm:w-14 sm:text-xl ${
          dark
            ? "border-white/20 bg-black/40 text-white"
            : "border-border-strong bg-background text-foreground"
        }`}
      >
        {value}
      </span>
      <span className={`label text-[0.6rem] ${dark ? "text-white/75" : ""}`}>{label}</span>
    </div>
  );
}

export function PromoCountdown({ endsAtIso, variant = "light" }: PromoCountdownProps) {
  const dark = variant === "dark";
  // Server rendering and the first browser render must use identical text.
  // Start the clock after mounting instead of comparing two different clocks.
  const [remaining, setRemaining] = useState<Remaining | null | undefined>(undefined);
  const deadlineValid = Number.isFinite(Date.parse(endsAtIso));

  useEffect(() => {
    const tick = () => setRemaining(computeRemaining(endsAtIso));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [endsAtIso]);

  if (remaining === null || !deadlineValid) {
    return (
      <div
        className={`px-4 py-3 text-center ${
          dark
            ? "border border-white/15 bg-black/30"
            : "border border-border-strong bg-surface"
        }`}
        role="status"
        aria-live="polite"
      >
        <p className={`text-sm font-medium ${dark ? "text-white/90" : "text-muted-foreground"}`}>
          {deadlineValid ? "Offer ended" : "Offer deadline unavailable"}
        </p>
        <p className={`mt-0.5 text-xs ${dark ? "text-white/75" : "text-muted-foreground"}`}>
          {deadlineValid
            ? "Founding rate is no longer available. Standard pricing applies."
            : "See plan details for current pricing."}
        </p>
      </div>
    );
  }

  return (
    <div role="timer" aria-live="off" aria-label="Founding offer time remaining" aria-busy={remaining === undefined}>
      <p className={`label mb-3 text-center ${dark ? "text-white/80" : ""}`}>
        Founding rate closes in
      </p>
      <div className="flex justify-center gap-3 sm:gap-4">
        <CountdownUnit value={remaining ? pad(remaining.days) : "…"} label="Days" dark={dark} />
        <CountdownUnit value={remaining ? pad(remaining.hours) : "…"} label="Hours" dark={dark} />
        <CountdownUnit value={remaining ? pad(remaining.minutes) : "…"} label="Mins" dark={dark} />
        <CountdownUnit value={remaining ? pad(remaining.seconds) : "…"} label="Secs" dark={dark} />
      </div>
    </div>
  );
}
