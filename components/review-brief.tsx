"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { RECOMMENDATION_LABEL, type ReviewBrief as Brief } from "@/lib/domain/review-brief";
import { shortDate, countdown } from "@/lib/format";
import { SnoozeButton } from "@/components/snooze-button";
import { useToast } from "@/components/toaster";
import { EstimatedValue } from "@/components/estimated-value";
import { useWorkspaceShortcut } from "@/components/workspace/workspace-keys";
import { requestAction, ACTION_UNCONFIRMED } from "@/lib/client/action-request";

const TONE = { pursue: "bg-pursue/15 text-pursue", pass: "bg-risk/15 text-risk", look: "bg-review/15 text-review" };
export function ReviewBriefPanel({ opportunityId, title, subtitle, brief, canDecide, closeHref, nextHref = null, recordHref, facts = [], evidence, canAnalyze = false }: {
  opportunityId: string; title: string; subtitle: string; brief: Brief; canDecide: boolean;
  closeHref: string; nextHref?: string | null; recordHref?: string;
  facts?: { label: string; value: string }[]; evidence?: ReactNode; canAnalyze?: boolean;
}) {
  const router = useRouter();
  const { push } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [snoozing, setSnoozing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passing, setPassing] = useState(false);
  const [reason, setReason] = useState("");
  const inFlight = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previousId = useRef(opportunityId);
  useEffect(() => {
    setPassing(false); setReason(""); setError(null); setBusy(null); setSnoozing(false);
    if (previousId.current !== opportunityId) heading.current?.focus({ preventScroll: true });
    previousId.current = opportunityId;
    return () => { inFlight.current?.abort(); inFlight.current = null; };
  }, [opportunityId]);
  const advance = useCallback(() => { router.push(nextHref ?? closeHref, { scroll: false }); router.refresh(); }, [router, nextHref, closeHref]);
  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (inFlight.current) return;
    const controller = new AbortController(); inFlight.current = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    setBusy(action); setError(null);
    try {
      const result = await requestAction(`/api/opportunities/${opportunityId}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }), signal: controller.signal });
      if (inFlight.current !== controller) return;
      if (!result.ok) { setError(result.error); return; }
      setPassing(false); setReason("");
      if (action === "dismiss") push({ message: `Passed on “${title}”. The record stays in history.`, undo: { endpoint: `/api/opportunities/${opportunityId}/action`, body: { action: "restore" } } });
      if (action === "pursue" || action === "dismiss") advance(); else router.refresh();
    } finally { clearTimeout(timer); if (inFlight.current === controller) { inFlight.current = null; setBusy(null); } }
  }, [opportunityId, push, title, advance, router]);
  const unconfirmed = error === ACTION_UNCONFIRMED;
  const disabled = busy != null || snoozing || unconfirmed;
  const pursue = useCallback(() => { if (canDecide && !disabled && !passing) void act("pursue"); }, [canDecide, disabled, passing, act]);
  useWorkspaceShortcut("mod+Enter", pursue, canDecide && !disabled && !passing);
  return <article className="flex min-w-0 flex-1 flex-col" aria-busy={busy != null}>
    <header className="border-b border-border/60 bg-surface px-5 py-5 sm:px-6">
      <Link href={closeHref} className="mb-3 inline-flex min-h-8 items-center text-sm text-accent lg:hidden">Back to review queue</Link>
      <div className="mb-3 flex flex-wrap items-center gap-2"><span className={`rounded-full px-3 py-1 text-sm font-semibold ${TONE[brief.recommendation]}`}>{RECOMMENDATION_LABEL[brief.recommendation]}</span><span className="text-sm text-muted-foreground">{brief.score == null ? "Not scored" : `Fit score ${brief.score} / 100`}</span></div>
      <h2 ref={heading} tabIndex={-1} className="break-words text-xl font-semibold leading-snug text-foreground outline-none sm:text-2xl">{title}</h2>
      <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
      <p className="mt-4 text-base leading-relaxed">{brief.rationale}</p>
    </header>
    <section aria-label="Your decision" className="border-b border-border/60 bg-accent-soft/40 px-5 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h3 className="font-semibold">Your decision</h3><span className="text-xs text-muted-foreground">{nextHref ? "Saved decisions open the next opportunity" : "Last opportunity in this queue"}</span></div>
      {!canDecide ? <p className="text-sm text-muted-foreground">You can read the evidence. A team member with decision access can pursue or pass.</p> : passing ? <div className="space-y-3">
        <label htmlFor="pass-reason" className="block text-sm font-medium">Why are you passing?</label>
        <textarea id="pass-reason" autoFocus value={reason} onChange={event => setReason(event.target.value)} rows={2} disabled={busy != null} placeholder="For example, outside our service area." className="input w-full resize-y text-sm" />
        <p className="text-xs text-muted-foreground">This reason is saved with the decision. The opportunity stays in history.</p>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void act("dismiss", { reason })} disabled={disabled || reason.trim().length < 3} className="btn-danger min-h-11 text-sm">{busy === "dismiss" ? "Saving decision…" : "Confirm pass"}</button><button type="button" disabled={busy != null} onClick={() => setPassing(false)} className="btn-ghost min-h-11 text-sm">Cancel</button></div>
      </div> : <div className="flex flex-wrap gap-2">
        <button type="button" onClick={pursue} disabled={disabled} className="btn-primary min-h-11 text-sm">{busy === "pursue" ? "Saving decision…" : nextHref ? "Pursue & next" : "Pursue"}</button>
        <button type="button" onClick={() => setPassing(true)} disabled={disabled} className="btn-ghost min-h-11 border border-border text-sm">Pass</button>
        <SnoozeButton key={opportunityId} kind="opportunity" id={opportunityId} disabled={busy != null || unconfirmed} onPending={setSnoozing} onUnconfirmed={() => setError(ACTION_UNCONFIRMED)} onSnoozed={advance} className="btn-ghost min-h-11 text-sm" />
      </div>}
      {brief.autoDismissAt && <p className="mt-3 text-sm text-review">Review closes {shortDate(brief.autoDismissAt)} ({countdown(brief.autoDismissAt)}). Snooze does not extend this review deadline.</p>}
      {error && <div role="alert" className="mt-3 rounded-lg border border-risk/40 bg-background p-3 text-sm text-risk"><p>{error}</p>{unconfirmed && <Link href={recordHref ?? `/opportunity/${opportunityId}`} className="mt-2 inline-flex min-h-11 items-center font-medium underline">Check this opportunity’s current status</Link>}</div>}
    </section>
    <div className="space-y-5 px-5 py-5 sm:px-6">
      <section aria-label="Key facts" className="rounded-xl border border-border/60 bg-surface p-4"><h3 className="mb-3 text-sm font-semibold">Key facts</h3><dl className="grid gap-4 sm:grid-cols-2">
        <div><dt className="text-xs text-muted-foreground">Agency bid deadline</dt><dd className="mt-1 text-sm font-medium">{brief.deadline ? `${shortDate(brief.deadline)} · ${countdown(brief.deadline)}` : "Not stated"}</dd></div>
        <div><dt className="text-xs text-muted-foreground">Contract value</dt><dd className="mt-1"><EstimatedValue value={brief.value.amount} source={brief.value.source} /></dd></div>
        {facts.map(fact => <div key={fact.label}><dt className="text-xs text-muted-foreground">{fact.label}</dt><dd className="mt-1 break-words text-sm">{fact.value}</dd></div>)}
      </dl></section>
      <section className="rounded-xl border border-review/35 bg-review/5 p-4" aria-label="Evidence and warnings"><h3 className="font-semibold">Check before deciding</h3><p className="mt-2 text-sm">{brief.confidence ? `Information confidence: ${Math.round(brief.confidence.percent)} / 100 (${brief.confidence.level}).` : "Information confidence has not been measured."}</p>
        {brief.conflicts.map(conflict => <div key={conflict.field} className="mt-3 border-l-2 border-risk pl-3 text-sm"><p className="font-semibold text-risk">Conflicting information: {conflict.field}</p><p>The notice says {conflict.fromNotice}. The document says {conflict.fromDocument}.</p><p className="mt-1 text-muted-foreground">{conflict.matters}</p></div>)}
        <BriefList items={brief.risks} empty="No risks were recorded in this assessment." />
        {brief.missing.length > 0 && <div className="mt-3"><h4 className="text-sm font-semibold">Still unknown</h4><ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{brief.missing.map(item => <li key={item}>{item}</li>)}</ul></div>}
      </section>
      <Disclosure title="Why this may fit" count={brief.positives.length}><BriefList items={brief.positives} empty="No strong fit factors were recorded." /></Disclosure>
      <Disclosure title="Work needed if we pursue"><ul className="list-disc space-y-2 pl-5 text-sm">{brief.effort.map(item => <li key={item}>{item}</li>)}</ul></Disclosure>
      {evidence && <Disclosure title="Score breakdown and source evidence">{evidence}</Disclosure>}
      <Disclosure title="Original notice and full record"><div className="flex flex-col items-start gap-2">{brief.sourceLinks.length === 0 && <p className="text-sm text-muted-foreground">No source link was saved. Check the full record for available documents.</p>}{brief.sourceLinks.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer noopener" className="inline-flex min-h-11 items-center text-sm text-accent underline">{link.label}</a>)}<Link href={recordHref ?? `/opportunity/${opportunityId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent underline">Open the full record</Link></div></Disclosure>
      {canDecide && <Disclosure title="More review options"><p className="mb-3 text-sm text-muted-foreground">Extend the review deadline if you need more time. Requesting analysis may use your account’s AI allowance; it does not make a decision.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={disabled} onClick={() => void act("extend_review")} className="btn-ghost min-h-11 border border-border text-sm">{busy === "extend_review" ? "Extending…" : "Extend review by one day"}</button>{canAnalyze && <button type="button" disabled={disabled} onClick={() => void act("rerun")} className="btn-ghost min-h-11 border border-border text-sm">{busy === "rerun" ? "Requesting…" : "Request more analysis"}</button>}</div></Disclosure>}
    </div>
  </article>;
}
function Disclosure({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <details className="rounded-xl border border-border/60 bg-surface open:shadow-sm"><summary className="min-h-12 cursor-pointer px-4 py-3 text-sm font-semibold marker:text-accent">{title}{count != null ? ` (${count})` : ""}</summary><div className="border-t border-border/40 px-4 py-4">{children}</div></details>;
}
function BriefList({ items, empty }: { items: { label: string; detail: string }[]; empty: string }) {
  return items.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{empty}</p> : <ul className="mt-3 space-y-3">{items.map(item => <li key={item.label}><p className="text-sm font-medium">{item.label}</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.detail}</p></li>)}</ul>;
}
