"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";

type Source = { label: string; href: string };
/** Read-only questions, loaded on request and grounded by the server. */
export function ContextualQuestion({ path }: { path: string }) {
  const id = useId();
  const request = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsConnection, setNeedsConnection] = useState(false);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  async function ask(text: string) {
    if (!text.trim() || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setQuestion(text); setBusy(true); setError(""); setAnswer(""); setSources([]); setNeedsConnection(false);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch("/api/guide/ask", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, question: text.trim() }), signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNeedsConnection(data.code === "claude_missing");
        throw new Error(typeof data.error === "string" ? data.error : "The answer could not be loaded. Try again.");
      }
      if (typeof data.answer !== "string" || !data.answer.trim()) throw new Error("No answer was returned. Try again.");
      setAnswer(data.answer);
      setSources(Array.isArray(data.sources) ? data.sources.filter((source: Source) =>
        typeof source?.label === "string" && typeof source.href === "string" && /^\/[A-Za-z0-9/_-]*(#[A-Za-z0-9_-]+)?$/.test(source.href)
      ) : []);
    } catch (cause) {
      if (request.current !== controller) return;
      setError(controller.signal.aborted ? "The answer took too long. Your work is saved. Try again." : cause instanceof Error ? cause.message : "Check your connection and try again.");
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  }
  return (
    <section className="rounded-xl border border-border bg-surface p-4 sm:p-5" aria-labelledby={`${id}-title`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={`${id}-title`} className="font-display text-lg">Ask about this opportunity</h2>
        <span className="rounded-full bg-automation-soft px-2 py-1 text-xs font-medium text-automation-foreground">AI assistance · Read only</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">Get help with the current status, blockers, and next step. Check the source documents for exact solicitation terms.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {["What needs my attention?", "Why is this blocked?", "What is the next step?"].map(prompt => (
          <button key={prompt} type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => void ask(prompt)}>{prompt}</button>
        ))}
      </div>
      <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={event => { event.preventDefault(); void ask(question); }}>
        <label className="sr-only" htmlFor={`${id}-question`}>Question about this opportunity</label>
        <input id={`${id}-question`} className="input min-w-0 flex-1" placeholder="Ask a question about this work" value={question} maxLength={500} onChange={event => setQuestion(event.target.value)} disabled={busy} />
        <button className="btn-primary" disabled={busy || !question.trim()}>{busy ? "Checking the record…" : "Ask BrostCo"}</button>
      </form>
      <p className="mt-2 text-xs text-muted-foreground">Uses your account’s AI connection. Usage charges may apply. Asking never sends messages or submits a bid.</p>
      {error && <div role="alert" className="mt-3 rounded-lg border border-risk/30 bg-risk-soft p-3 text-sm text-risk">{error}{needsConnection && <Link className="ml-2 underline" href="/settings/integrations">Open Connections</Link>}</div>}
      <div aria-live="polite" aria-busy={busy}>
        {answer && <div className="mt-4 border-t border-border pt-4">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>
          {sources.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"><span className="text-muted-foreground">Information checked:</span>{sources.map(source => <Link className="text-accent underline" href={source.href} key={source.href}>{source.label}</Link>)}</div>}
          <p className="mt-2 text-xs text-muted-foreground">Based on recorded workflow facts, not a fresh review of every source file.</p>
        </div>}
      </div>
    </section>
  );
}
