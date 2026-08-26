"use client";

/**
 * Persistent Guide Me panel: structured guidance, in-panel adapters, live
 * pulse sync, optional Claude narration/Q&A, and deep-link arrival context.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { highlightGuideTarget } from "@/lib/guide-highlight";
import { GuideStepActions } from "@/components/guide-adapters";
import { trackClientEvent } from "@/lib/client-analytics";
import type { GuideAdapters, GuideStep, PageGuide } from "@/lib/domain/page-guide";

type Mode = "guide" | "ask" | "explain" | "score" | "terms";

export function openGuideWizard() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-guide-wizard"));
  }
}

export function GuideWizard() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("guide");
  const [guide, setGuide] = useState<PageGuide | null>(null);
  const [adapters, setAdapters] = useState<GuideAdapters>({});
  const [badge, setBadge] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [narrateError, setNarrateError] = useState<string | null>(null);
  const [askInput, setAskInput] = useState("");
  const [askBusy, setAskBusy] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [askThread, setAskThread] = useState<{ role: "user" | "assistant"; content: string }[]>(
    []
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const fingerprintRef = useRef<string | null>(null);
  const keepStepRef = useRef(false);
  const pendingStepRef = useRef<string | null>(null);
  const openedFromUrl = useRef(false);

  const applyStepFocus = useCallback((g: PageGuide, stepId: string | null) => {
    if (!stepId) {
      setStepIndex(0);
      return;
    }
    const idx = g.steps.findIndex((s) => s.id === stepId);
    setStepIndex(idx >= 0 ? idx : 0);
    const step = idx >= 0 ? g.steps[idx] : null;
    if (step?.target) {
      window.setTimeout(() => highlightGuideTarget(step.target), 200);
    }
  }, []);

  const load = useCallback(
    async (opts?: { silent?: boolean; keepStep?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/guide?path=${encodeURIComponent(pathname)}`, {
          cache: "no-store",
        });
        const data = (await res.json().catch(() => ({}))) as {
          guide?: PageGuide;
          adapters?: GuideAdapters;
          fingerprint?: string;
          error?: string;
        };
        if (!res.ok) {
          setError(data.error ?? "Could not load guidance.");
          if (!opts?.silent) {
            setGuide(null);
            setAdapters({});
          }
          return;
        }
        const g = data.guide ?? null;
        setGuide(g);
        setAdapters(data.adapters ?? {});
        if (g) setBadge(g.badgeCount);
        if (typeof data.fingerprint === "string") {
          fingerprintRef.current = data.fingerprint;
        }
        if (!opts?.keepStep && !keepStepRef.current) {
          if (g) applyStepFocus(g, pendingStepRef.current);
          pendingStepRef.current = null;
        }
        keepStepRef.current = false;
        setLiveNote(null);
        setNarration(null);
        setNarrateError(null);
      } catch {
        setError("Could not load guidance.");
        if (!opts?.silent) {
          setGuide(null);
          setAdapters({});
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [pathname, applyStepFocus]
  );

  // Slim badge while closed.
  useEffect(() => {
    if (open) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/guide/pulse?path=${encodeURIComponent(pathname)}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as { badgeCount?: number; fingerprint?: string };
        if (cancelled) return;
        setBadge(Number(data.badgeCount ?? 0));
        if (typeof data.fingerprint === "string") fingerprintRef.current = data.fingerprint;
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pathname, open]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("open-guide-wizard", onOpen);
    return () => window.removeEventListener("open-guide-wizard", onOpen);
  }, []);

  // Arrival context: ?guide=1&guideStep=&guideFocus=
  useEffect(() => {
    const guideParam = searchParams.get("guide");
    if (guideParam !== "1" && guideParam !== "true") {
      openedFromUrl.current = false;
      return;
    }
    if (openedFromUrl.current) return;
    openedFromUrl.current = true;
    pendingStepRef.current = searchParams.get("guideStep");
    const focus = searchParams.get("guideFocus");
    setOpen(true);
    if (focus) window.setTimeout(() => highlightGuideTarget(focus), 350);
    // Strip query so refresh doesn't reopen forever.
    const params = new URLSearchParams(searchParams.toString());
    params.delete("guide");
    params.delete("guideStep");
    params.delete("guideFocus");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

  useEffect(() => {
    if (!open) return;
    void load();
    setMode("guide");
    trackClientEvent("guide_open", { path: pathname });
  }, [open, load, pathname]);

  useEffect(() => {
    if (!open) {
      setGuide(null);
      setAdapters({});
      setAskThread([]);
      setAskInput("");
      setLiveNote(null);
      fingerprintRef.current = null;
    }
  }, [pathname, open]);

  useEffect(() => {
    if (!open) return;
    let stopped = false;

    async function pulse(): Promise<string | null> {
      try {
        const res = await fetch("/api/today/pulse", { cache: "no-store" });
        if (!res.ok) return null;
        const data = (await res.json()) as { fingerprint?: string };
        return data.fingerprint ?? null;
      } catch {
        return null;
      }
    }

    async function tick() {
      const fp = await pulse();
      if (stopped || fp == null) return;
      if (fingerprintRef.current == null) {
        fingerprintRef.current = fp;
        return;
      }
      if (fp !== fingerprintRef.current) {
        setLiveNote("Workspace updated. Refreshing guidance…");
        keepStepRef.current = true;
        await load({ silent: true, keepStep: true });
        router.refresh();
        trackClientEvent("guide_live_refresh", { path: pathname });
      }
    }

    void tick();
    const timer = window.setInterval(() => void tick(), 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, load, router, pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => panelRef.current?.focus(), 40);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  async function afterAction() {
    trackClientEvent("guide_action_complete", {
      stepId: guide?.steps[stepIndex]?.id,
      kind: guide?.steps[stepIndex]?.kind,
    });
    router.refresh();
    keepStepRef.current = true;
    await load({ keepStep: true });
  }

  async function requestNarration() {
    if (!guide) return;
    setNarrating(true);
    setNarrateError(null);
    try {
      const res = await fetch("/api/guide/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guide }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        narration?: string;
        error?: string;
      };
      if (!res.ok) {
        setNarrateError(data.error ?? "Could not generate narration.");
        return;
      }
      setNarration(data.narration ?? null);
      trackClientEvent("guide_narrate", { pageKey: guide.pageKey });
    } catch {
      setNarrateError("Could not generate narration.");
    } finally {
      setNarrating(false);
    }
  }

  async function askQuestion(e?: React.FormEvent) {
    e?.preventDefault();
    if (!guide || !askInput.trim() || askBusy) return;
    const question = askInput.trim();
    setAskInput("");
    setAskBusy(true);
    setAskError(null);
    const nextThread = [...askThread, { role: "user" as const, content: question }];
    setAskThread(nextThread);
    try {
      const res = await fetch("/api/guide/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guide,
          question,
          history: askThread,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { answer?: string; error?: string };
      if (!res.ok) {
        setAskError(data.error ?? "Could not answer.");
        return;
      }
      setAskThread([...nextThread, { role: "assistant", content: data.answer ?? "" }]);
      trackClientEvent("guide_ask", { pageKey: guide.pageKey });
    } catch {
      setAskError("Could not answer.");
    } finally {
      setAskBusy(false);
    }
  }

  const steps = guide?.steps ?? [];
  const active = steps[stepIndex] ?? null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed z-[65] hidden items-center gap-2 rounded-md border border-gold/40 bg-surface px-4 py-3 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold dark:bg-shell md:bottom-6 md:right-6 md:flex"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden className="text-gold-text">
          ?
        </span>
        Guide Me
        {badge > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-[11px] font-semibold text-ink">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80]">
          <button
            type="button"
            className="absolute inset-0 bg-black/40"
            aria-label="Close guide"
            onClick={() => setOpen(false)}
          />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-xl border border-border/55 bg-background shadow-2xl outline-none dark:border-white/10 md:inset-y-0 md:bottom-auto md:left-auto md:right-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-l md:border-t-0 md:border-b-0"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
              <div className="min-w-0">
                <p className="eyebrow-gold">Guide Me</p>
                <h2 id={titleId} className="font-display text-lg text-foreground">
                  {guide?.headline ?? (loading ? "Loading…" : "Page guidance")}
                </h2>
                {liveNote && <p className="mt-1 text-xs text-pursue">{liveNote}</p>}
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2 md:px-4">
              {(
                [
                  ["guide", "What to do"],
                  ["ask", "Ask"],
                  ["explain", "Explain page"],
                  ...(guide?.scoreExplain ? ([["score", "Why this score"]] as const) : []),
                  ["terms", "Terms"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setMode(key as Mode)}
                  className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium ${
                    mode === key
                      ? "bg-foreground text-background"
                      : "bg-surface text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="scroll-thin flex-1 overflow-y-auto px-4 py-4 md:px-5">
              {loading && !guide && (
                <p className="text-sm text-slate-500">Reading your account and this page…</p>
              )}
              {error && <p className="text-sm text-risk">{error}</p>}

              {guide && mode === "guide" && (
                <GuideBody
                  guide={guide}
                  adapters={adapters}
                  active={active}
                  stepIndex={stepIndex}
                  stepCount={steps.length}
                  narration={narration}
                  narrating={narrating}
                  narrateError={narrateError}
                  onNarrate={() => void requestNarration()}
                  onAskTab={() => setMode("ask")}
                  onStep={setStepIndex}
                  onHighlight={(target) => highlightGuideTarget(target)}
                  onDone={async () => {
                    await afterAction();
                  }}
                  onClose={() => setOpen(false)}
                />
              )}

              {guide && mode === "ask" && (
                <div className="flex h-full min-h-[16rem] flex-col gap-3">
                  <p className="text-xs text-slate-500">
                    Ask about this page, blockers, scores, or terms. Answers stay grounded in your
                    live account facts.
                  </p>
                  <div className="scroll-thin flex-1 space-y-2 overflow-y-auto">
                    {askThread.length === 0 && (
                      <div className="flex flex-wrap gap-2">
                        {[
                          "What should I do next?",
                          "Why is this blocked?",
                          "What is Brost Co handling?",
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            className="btn-ghost text-xs"
                            onClick={() => {
                              setAskInput(q);
                            }}
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                    )}
                    {askThread.map((m, i) => (
                      <div
                        key={`${m.role}-${i}`}
                        className={`rounded-md px-3 py-2 text-sm ${
                          m.role === "user"
                            ? "ml-6 bg-foreground text-background"
                            : "mr-4 border border-border bg-surface text-slate-800"
                        }`}
                      >
                        {m.content}
                      </div>
                    ))}
                  </div>
                  {askError && <p className="text-xs text-risk">{askError}</p>}
                  <form onSubmit={(e) => void askQuestion(e)} className="flex gap-2">
                    <input
                      className="input flex-1"
                      value={askInput}
                      onChange={(e) => setAskInput(e.target.value)}
                      placeholder="Ask a question…"
                      disabled={askBusy}
                    />
                    <button type="submit" className="btn-primary text-xs" disabled={askBusy}>
                      {askBusy ? "…" : "Ask"}
                    </button>
                  </form>
                </div>
              )}

              {guide && mode === "explain" && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    {guide.pageExplain?.title ?? "About this page"}
                  </p>
                  <ul className="list-disc space-y-2 pl-5 text-sm text-slate-600">
                    {(
                      guide.pageExplain?.points ?? [
                        "This page is part of your Brost Co workspace.",
                      ]
                    ).map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                  <Link
                    href="/how-it-works"
                    className="btn-secondary text-xs"
                    onClick={() => setOpen(false)}
                  >
                    See the full journey
                  </Link>
                </div>
              )}

              {guide && mode === "score" && guide.scoreExplain && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-foreground">
                    Why is this scored {Math.round(guide.scoreExplain.total)}?
                  </p>
                  <p className="text-sm text-slate-600">{guide.scoreExplain.summary}</p>
                  <ul className="space-y-2">
                    {guide.scoreExplain.factors.map((f) => (
                      <li
                        key={f.label}
                        className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
                      >
                        <div className="flex justify-between gap-2 font-medium text-foreground">
                          <span>{f.label}</span>
                          <span className="num text-slate-500">
                            {f.points}/{f.max}
                          </span>
                        </div>
                        {f.reasoning && (
                          <p className="mt-1 text-xs text-slate-600">{f.reasoning}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {guide && mode === "terms" && (
                <div className="space-y-2">
                  {guide.terms.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No special terms for this page. Try Ask for UEI, NAICS, set-asides, or scores.
                    </p>
                  ) : (
                    guide.terms.map((t) => (
                      <details
                        key={t.key}
                        className="rounded-md border border-border bg-surface px-3 py-2"
                      >
                        <summary className="cursor-pointer text-sm font-medium text-foreground">
                          {t.label}
                        </summary>
                        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{t.tip}</p>
                      </details>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function GuideBody({
  guide,
  adapters,
  active,
  stepIndex,
  stepCount,
  narration,
  narrating,
  narrateError,
  onNarrate,
  onAskTab,
  onStep,
  onHighlight,
  onDone,
  onClose,
}: {
  guide: PageGuide;
  adapters: GuideAdapters;
  active: GuideStep | null;
  stepIndex: number;
  stepCount: number;
  narration: string | null;
  narrating: boolean;
  narrateError: string | null;
  onNarrate: () => void;
  onAskTab: () => void;
  onStep: (i: number) => void;
  onHighlight: (target?: string) => void;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-slate-700">{guide.situation}</p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={narrating}
          onClick={onNarrate}
        >
          {narrating
            ? "Writing…"
            : narration
              ? "Refresh plain-English summary"
              : "Explain in plain English"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onAskTab}>
          Ask a question
        </button>
      </div>
      {narrateError && <p className="text-xs text-risk">{narrateError}</p>}
      {narration && (
        <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-3 text-sm leading-relaxed text-slate-800">
          {narration}
        </div>
      )}

      {(guide.stageLabel || guide.scoreLine) && (
        <div className="flex flex-wrap gap-2 text-xs">
          {guide.stageLabel && (
            <span className="badge bg-surface text-slate-600">Stage: {guide.stageLabel}</span>
          )}
          {guide.scoreLine && (
            <span className="badge bg-accent-soft text-accent-strong">{guide.scoreLine}</span>
          )}
          {guide.automationPaused && (
            <span className="badge bg-review/15 text-review">Automation paused</span>
          )}
        </div>
      )}

      {guide.completed.length > 0 && (
        <Section title="What's already complete">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {guide.completed.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      )}

      {guide.needsAttention.length > 0 && !guide.idle && (
        <Section title="What needs your attention">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {guide.needsAttention.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      )}

      {guide.brostHandling.length > 0 && (
        <Section title="Brost Co is handling this">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
            {guide.brostHandling.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Section>
      )}

      {guide.whatHappensNext && (
        <Section title="What happens next">
          <p className="text-sm text-slate-600">{guide.whatHappensNext}</p>
        </Section>
      )}

      {guide.idle ? (
        <div className="rounded-md border border-pursue/30 bg-pursue-soft px-3 py-3">
          <p className="text-sm font-semibold text-foreground">
            You&apos;re done here. Brost Co will handle the next step automatically.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/today" className="btn-secondary text-xs" onClick={onClose}>
              Back to Today
            </Link>
          </div>
        </div>
      ) : active ? (
        <div className="rounded-md border border-border-strong bg-surface px-3 py-3">
          {stepCount > 1 && (
            <p className="label mb-1 text-slate-500">
              Step {stepIndex + 1} of {stepCount}
            </p>
          )}
          <p className="text-sm font-semibold text-foreground">{active.title}</p>
          <p className="mt-1 text-sm text-slate-600">{active.why}</p>
          {active.after && guide.experience === "new" && (
            <p className="mt-1 text-xs text-slate-500">Then: {active.after}</p>
          )}
          <div className="mt-3">
            <GuideStepActions
              step={active}
              adapters={adapters}
              onHighlight={onHighlight}
              onDone={onDone}
              onClose={onClose}
            />
          </div>
          {stepCount > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={stepIndex === 0}
                onClick={() => onStep(Math.max(0, stepIndex - 1))}
              >
                Previous
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={stepIndex >= stepCount - 1}
                onClick={() => onStep(Math.min(stepCount - 1, stepIndex + 1))}
              >
                Next step
              </button>
            </div>
          )}
        </div>
      ) : null}

      <button
        type="button"
        className="text-xs text-slate-500 underline-offset-2 hover:underline"
        onClick={() => void onDone()}
      >
        Refresh guidance
      </button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="label mb-1.5 text-slate-500">{title}</h3>
      {children}
    </section>
  );
}
