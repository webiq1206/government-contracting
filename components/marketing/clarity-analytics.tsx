"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ANALYTICS_CHOICE_KEY, analyticsAllowed, setGa4Consent, syncGa4Page } from "@/lib/client/ga4";

const CHOICE_KEY = ANALYTICS_CHOICE_KEY;
const OPEN_PREFERENCES = "brostco:analytics-preferences";
type Choice = "granted" | "denied" | null;
type Clarity = ((...args: unknown[]) => void) & { q?: unknown[][] };
declare global { interface Window { clarity?: Clarity } }

/** In-flow entry point, shared by Settings and public privacy/footer links. */
export function AnalyticsPreferencesButton({ inheritColor = false }: { inheritColor?: boolean }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => setAllowed(analyticsAllowed()), []);
  return <button type="button" disabled={!allowed}
    title={allowed ? undefined : "Browser privacy settings disable optional analytics."}
    onClick={() => window.dispatchEvent(new Event(OPEN_PREFERENCES))}
    className={`inline-flex min-h-11 items-center rounded px-2 py-2 text-left text-xs underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-default ${inheritColor ? "text-inherit focus-visible:outline-current" : "text-muted-foreground focus-visible:outline-accent"}`}>
    Analytics preferences
  </button>;
}

/** Consent for Google Analytics. Clarity itself is the site-wide head snippet. */
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
    if (!ready || !window.clarity) return;
    if (choice === "denied") {
      window.clarity("consentv2", { analytics_Storage: "denied", ad_Storage: "denied" });
      window.clarity("stop");
      return;
    }
    if (choice === "granted") {
      window.clarity("consentv2", { analytics_Storage: "granted", ad_Storage: "denied" });
    }
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
    const clarityTag = document.querySelector('script[src*="clarity.ms/tag/"]');
    if (choice !== null && (clarityTag || document.getElementById("brostco-ga4"))) location.reload();
  }

  if (!ready) return null;
  if (choice !== null && !settings) return null;
  return (
    <section aria-label="Optional analytics" className="fixed bottom-3 left-3 right-3 z-50 mx-auto max-w-xl rounded-xl border border-border-strong bg-surface p-4 text-sm text-foreground shadow-lg">
      <p>Allow Google Analytics to measure website visits and signups? Microsoft Clarity is included on every page, with page text and forms masked. Optional analytics uses cookies. <a className="underline" href="/privacy">Privacy details</a></p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button ref={decline} type="button" className="min-h-11 rounded border border-border-strong bg-surface px-4 py-2 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => choose("denied")}>Decline</button>
        <button type="button" className="min-h-11 rounded bg-accent px-4 py-2 text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" onClick={() => choose("granted")}>Allow analytics</button>
      </div>
    </section>
  );
}
