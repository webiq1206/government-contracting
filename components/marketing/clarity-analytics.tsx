"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_CHOICE_KEY, analyticsAllowed, setGa4Consent, syncGa4Page } from "@/lib/client/ga4";

const CHOICE_KEY = ANALYTICS_CHOICE_KEY;
const PROJECT_ID = "ypg5p3oq1h";
const OPEN_PREFERENCES = "brostco:analytics-preferences";
type Choice = "granted" | "denied" | null;
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global { interface Window { clarity?: Clarity } }

/** In-flow entry point, shared by Settings and public privacy/footer links. */
export function AnalyticsPreferencesButton() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(analyticsAllowed()), []);
  return <button type="button" disabled={!allowed}
    title={allowed ? undefined : "Browser privacy settings disable optional analytics."}
    onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES))}
    className="inline-flex min-h-11 items-center rounded px-2 py-2 text-left text-xs text-muted-foreground underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default">
    Analytics preferences
  </button>;
}

/** Optional, masked analytics. No tracker request is made before consent. */
export function ClarityAnalytics() {
  const pathname = usePathname();
  const [choice, setChoice] = useState<Choice>(null);
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const decline = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!analyticsAllowed()) return;
    try {
      const saved = localStorage.getItem(CHOICE_KEY);
      if (saved === "granted" || saved === "denied") setChoice(saved);
    } catch { /* Storage may be disabled; keep the choice in memory. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    const open = () => {
      if (!analyticsAllowed()) return;
      opener.current = document.activeElement as HTMLElement | null;
      setSettings(true);
    };
    window.addEventListener(OPEN_PREFERENCES, open);
    return () => window.removeEventListener(OPEN_PREFERENCES, open);
  }, []);
  useEffect(() => {
    if (!settings) return;
    decline.current?.focus({ preventScroll: true });
    return () => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); };
  }, [settings]);

  useEffect(() => {
    setGa4Consent(ready && choice === "granted");
    if (ready && choice === "granted") syncGa4Page(pathname);
  }, [choice, ready, pathname]);

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
    setGa4Consent(value === "granted");
    if (value === "denied" && window.clarity) {
      window.clarity("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
      window.clarity("stop");
    }
    setChoice(value);
    setSettings(false);
    // A fresh document unloads the tracker after withdrawal and restarts it
    // correctly if a visitor changes a previous decision.
    if (choice !== null && (document.getElementById("brostco-clarity") || document.getElementById("brostco-ga4"))) location.reload();
  }

  if (!ready) return null;
  if (choice !== null && !settings) return null;
  return (
    <section aria-label="Optional analytics" className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-xl rounded-xl border border-border-strong bg-surface p-4 text-sm text-foreground shadow-lg">
      <p>Allow Google Analytics to measure website visits and signups, and Microsoft Clarity to help us improve BrostCo with masked recordings and heatmaps? Optional analytics uses cookies. <a className="underline" href="/privacy">Privacy details</a></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={decline} type="button" className="min-h-11 rounded border border-border-strong bg-surface px-4 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => choose("denied")}>Decline</button>
        <button type="button" className="min-h-11 rounded bg-accent px-4 py-2 text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => choose("granted")}>Allow analytics</button>
      </div>
    </section>
  );
}
