"use client";

/**
 * Persistent Guide Me panel. Loads structured guidance + in-panel adapters,
 * stays live via Today's pulse fingerprint, and can optionally ask Claude to
 * narrate the same facts in plain English.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { highlightGuideTarget } from "@/lib/guide-highlight";
import { GuideStepActions } from "@/components/guide-adapters";
import type { GuideAdapters, GuideStep, PageGuide } from "@/lib/domain/page-guide";

type Mode = "guide" | "explain" | "score" | "terms";

export function openGuideWizard() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("open-guide-wizard"));
  }
}

export function GuideWizard() {
  const pathname = usePathname();
  const router = useRouter();
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("guide");
  const [guide, setGuide] = useState<PageGuide | null>(null);
  const [adapters, setAdapters] = useState<GuideAdapters>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);
  const [narrateError, setNarrateError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const fingerprintRef = useRef<string | null>(null);
  const keepStepRef = useRef(false);

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
        setGuide(data.guide ?? null);
        setAdapters(data.adapters ?? {});
        if (typeof data.fingerprint === "string") {
          fingerprintRef.current = data.fingerprint;
        }
        if (!opts?.keepStep && !keepStepRef.current) setStepIndex(0);
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
    [pathname]
  );

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener("open-guide-wizard", onOpen);
    return () => window.removeEventListener("open-guide-wizard", onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    setMode("guide");
  }, [open, load]);

  useEffect(() => {
    if (!open) {
      setGuide(null);
      setAdapters({});
      fingerprintRef.current = null;
      setNarration(null);
      setLiveNote(null);
    }
  }, [pathname, open]);

  // Live sync with Today pulse while the panel is open.
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
  }, [open, load, router]);

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
    } catch {
      setNarrateError("Could not generate narration.");
    } finally {
      setNarrating(false);
    }
  }

  const steps = guide?.steps ?? [];
  const active = steps[stepIndex] ?? null;
  const badge = guide?.badgeCount ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed z-[65] flex items-center gap-2 rounded-full border border-border-strong bg-foreground px-4 py-3 text-sm font-medium text-white shadow-lg transition-colors hover:bg-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 md:bottom-6 md:right-6"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span aria-hidden className="text-accent">
          ?
        </span>
        Guide Me
        {badge > 0 && (
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-foreground">
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
            className="absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-xl border border-border bg-background shadow-2xl outline-none md:inset-y-0 md:bottom-auto md:left-auto md:right-0 md:h-full md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-l md:border-t-0 md:border-b-0"
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 md:px-5">
              <div className="min-w-0">
                <p className="label text-accent-strong">Guide Me</p>
                <h2 id={titleId} className="font-display text-lg text-foreground">
                  {guide?.headline ?? (loading ? "Loading…" : "Page guidance")}
                </h2>
                {liveNote && (
                  <p className="mt-1 text-xs text-pursue">{liveNote}</p>
                )}
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
                      ? "bg-foreground text-white"
                      : "bg-surface text-slate-600 hover:bg-slate-200"
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
                  onStep={setStepIndex}
                  onHighlight={(target) => highlightGuideTarget(target)}
                  onDone={async () => {
                    await afterAction();
                  }}
                  onClose={() => setOpen(false)}
                />
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
                  {guide.experience === "new" && (
                    <p className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-slate-600">
                      New here? Brost Co automates most government-contracting steps. You only act
                      when this guide (or Today) says the ball is with you.
                    </p>
                  )}
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
                  <button
                    type="button"
                    className="btn-ghost text-xs"
                    onClick={() => {
                      highlightGuideTarget("score");
                      setOpen(false);
                    }}
                  >
                    Show score on page
                  </button>
                </div>
              )}

              {guide && mode === "terms" && (
                <div className="space-y-2">
                  {guide.terms.length === 0 ? (
                    <p className="text-sm text-slate-500">
                      No special terms for this page. Open an opportunity or company profile for
                      UEI, NAICS, scoring, and set-aside explanations.
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
          {narrating ? "Writing…" : narration ? "Refresh plain-English summary" : "Explain in plain English"}
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
            {guide.opportunityId && (
              <>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    onHighlight("workflow");
                    onClose();
                  }}
                >
                  View workflow
                </button>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    onHighlight("brief");
                    onClose();
                  }}
                >
                  Review solicitation
                </button>
              </>
            )}
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
