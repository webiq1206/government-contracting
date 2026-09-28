"use client";

import { useEffect, useState } from "react";

const CHOICE_KEY = "brostco-clarity-consent";
const PROJECT_ID = "ypg5p3oq1h";
type Choice = "granted" | "denied" | null;
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global { interface Window { clarity?: Clarity } }

/** Optional, masked analytics. No tracker request is made before consent. */
export function ClarityAnalytics() {
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (!["brostco.com", "www.brostco.com"].includes(location.hostname)) return;
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return;
    try {
      const saved = localStorage.getItem(CHOICE_KEY);
      if (saved === "granted" || saved === "denied") setChoice(saved);
    } catch { /* Storage may be disabled; keep the choice in memory. */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || choice !== "granted" || document.getElementById("brostco-clarity")) return;
    const queue: Clarity = (...args) => { (queue.q ??= []).push(args); };
    window.clarity ??= queue;
    window.clarity("consentv2", { analytics_Storage: "granted", ad_Storage: "denied" });
    const script = document.createElement("script");
    script.id = "brostco-clarity";
    script.async = true;
    script.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
    document.head.appendChild(script);
  }, [choice, ready]);

  function choose(value: Exclude<Choice, null>) {
    try { localStorage.setItem(CHOICE_KEY, value); } catch { /* Session-only choice. */ }
    if (value === "denied" && window.clarity) {
      window.clarity("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
      window.clarity("stop");
    }
    setChoice(value);
    setSettings(false);
    // A fresh document unloads the tracker after withdrawal and restarts it
    // correctly if a visitor changes a previous decision.
    if (choice !== null && document.getElementById("brostco-clarity")) location.reload();
  }

  if (!ready) return null;
  if (choice !== null && !settings) return <button type="button" onClick={() => setSettings(true)} className="fixed bottom-2 left-2 z-50 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm">Analytics preferences</button>;
  return (
    <section aria-label="Optional analytics" className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-xl rounded-xl border border-slate-300 bg-white p-4 text-sm text-slate-900 shadow-lg">
      <p>Allow Microsoft Clarity to help us improve BrostCo with masked session recordings and heatmaps? Optional analytics uses cookies. <a className="underline" href="/privacy">Privacy details</a></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="rounded border border-slate-400 px-4 py-2" onClick={() => choose("denied")}>Decline</button>
        <button type="button" className="rounded bg-slate-900 px-4 py-2 text-white" onClick={() => choose("granted")}>Allow analytics</button>
      </div>
    </section>
  );
}
