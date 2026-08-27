"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import {
  DIAGNOSTIC_SUMMARY,
  FEEDBACK_CATEGORIES,
  MESSAGE_MAX,
  messageProblem,
} from "@/lib/domain/feedback";

/**
 * Say the product is wrong.
 *
 * Two decisions worth stating. The category is required, because "something
 * is broken" and "a number looks wrong" go to different places and the second
 * one is the report this product most needs to hear. And the diagnostic
 * checkbox is off by default with its contents written out beside it, because
 * a consent control that does not say what it consents to is decoration.
 */

/** Only what the allow-list on the server will keep. Gathered here so the
 *  sentence beside the checkbox and the payload cannot drift apart. */
function collectDiagnostics(): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  try {
    out.viewportWidth = window.innerWidth;
    out.viewportHeight = window.innerHeight;
    out.screenWidth = window.screen?.width ?? 0;
    out.screenHeight = window.screen?.height ?? 0;
    out.devicePixelRatio = window.devicePixelRatio ?? 1;
    out.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    out.language = navigator.language ?? "";
    out.theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
    out.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // A browser that refuses any of this still sends the report.
  }
  return out;
}

export function FeedbackForm() {
  const pathname = usePathname();
  const [category, setCategory] = useState<string>("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState("");
  const [consent, setConsent] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ note: string | null } | null>(null);

  const problem = message.length > 0 ? messageProblem(message) : null;
  const chosen = FEEDBACK_CATEGORIES.find((c) => c.key === category);

  async function send() {
    setError(null);
    const bad = messageProblem(message);
    if (!category) {
      setError("Pick what kind of problem this is.");
      return;
    }
    if (bad) {
      setError(bad);
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.set("category", category);
      form.set("message", message);
      // The screen they were on when it happened, which is theirs to correct:
      // most people open this page from somewhere else.
      form.set("page", page.trim() || pathname || "");
      form.set("consent", consent ? "true" : "false");
      if (consent) form.set("diagnostics", JSON.stringify(collectDiagnostics()));
      if (file) form.set("screenshot", file);

      const res = await fetch("/api/feedback", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        note?: string | null;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "The report could not be sent.");
        return;
      }
      setSent({ note: data.note ?? null });
      setMessage("");
      setFile(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <div className="card max-w-xl space-y-3" role="status">
        <p className="text-sm font-semibold text-pursue">That is on the record.</p>
        <p className="text-sm leading-relaxed text-slate-700">
          It is filed against this account with the page you named, so nobody has to
          ask you which screen you meant. You will not get an automatic reply; if it
          needs a conversation, somebody writes to you.
        </p>
        {sent.note && <p className="text-sm leading-relaxed text-review">{sent.note}</p>}
        <button type="button" className="btn-ghost w-fit text-xs" onClick={() => setSent(null)}>
          Send another
        </button>
      </div>
    );
  }

  return (
    <div className="card max-w-xl space-y-5">
      <fieldset>
        <legend className="label mb-2">What kind of problem is it?</legend>
        <div className="space-y-2">
          {FEEDBACK_CATEGORIES.map((c) => (
            <label
              key={c.key}
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 transition ${
                category === c.key ? "border-accent/60 bg-accent/5" : "border-border bg-surface"
              }`}
            >
              <input
                type="radio"
                name="feedback-category"
                className="mt-1"
                value={c.key}
                checked={category === c.key}
                onChange={() => setCategory(c.key)}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{c.label}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  {c.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label className="label mb-1.5 block" htmlFor="feedback-message">
          What happened?
        </label>
        <textarea
          id="feedback-message"
          className="input min-h-[140px] resize-y text-sm leading-relaxed"
          value={message}
          maxLength={MESSAGE_MAX + 200}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={
            chosen?.key === "wrong_number"
              ? "Which figure, on which screen, and what you expected it to say."
              : "What you were doing, what you expected, and what happened instead."
          }
        />
        <p className="mt-1 flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{problem ?? "The more specific it is, the sooner it can be acted on."}</span>
          <span className="num shrink-0">
            {message.trim().length}/{MESSAGE_MAX}
          </span>
        </p>
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="feedback-page">
          Which screen was it on?
        </label>
        <input
          id="feedback-page"
          className="input font-mono text-sm"
          value={page}
          onChange={(e) => setPage(e.target.value)}
          placeholder={pathname ?? "/today"}
        />
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Only the path is kept, never anything after the question mark: which screen
          you were on is useful, and what you were searching for is nobody else&rsquo;s
          business.
        </p>
      </div>

      <div>
        <label className="label mb-1.5 block" htmlFor="feedback-shot">
          A screenshot, if you have one
        </label>
        <input
          id="feedback-shot"
          type="file"
          accept="image/*"
          className="input text-sm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Stored against this account only, like every other file here. Check it for
          anything you would not want on the record before you attach it.
        </p>
      </div>

      {/* Off by default, and it says what it attaches. A consent control that
          does not name its contents is decoration. */}
      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background px-3 py-2.5">
        <input
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">
            Attach details about my browser and screen
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
            {DIAGNOSTIC_SUMMARY}
          </span>
        </span>
      </label>

      {error && (
        <p className="text-sm text-risk" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <button
          type="button"
          className="btn-primary"
          onClick={send}
          disabled={busy || !category || messageProblem(message) !== null}
        >
          {busy ? "Sending…" : "Send this report"}
        </button>
        {/* The account and the sender are on the report either way. Said
            here, before it is sent, rather than discovered afterwards. */}
        <span className="text-xs leading-relaxed text-muted-foreground">
          Your account and your email address go on the report, so nobody has to
          ask which workspace you meant.
        </span>
      </div>
    </div>
  );
}
