"use client";

/**
 * Call Workspace: a call guide and a data-entry form, in that order.
 *
 * It used to be a document. Nine facts about the project, four blocks of
 * required qualifications, every prior email, a five-sentence opening
 * paragraph, and then twenty-odd fields across six numbered steps, several
 * asking again for something a field above had already captured. All of it
 * above the fold, all of it while somebody was on the phone waiting.
 *
 * What it is now:
 *   - the header is what you need in the first second: who, what trade, dial
 *   - the brief is one line of chips, and everything else about the job is
 *     behind a disclosure you open before dialling, not during
 *   - the guide is a flat list of questions in conversation order, each with
 *     the input its answer deserves, one row each
 *   - instructions are never mixed into questions: the two lines you actually
 *     read aloud are marked as such and nothing else is prose
 *   - what you record after hanging up is separated from what you ask
 *
 * The question set itself comes from lib/domain/call-guide, which is where
 * deduplication and relevance live.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CallCardRow } from "@/lib/data";
import { currency, shortDate } from "@/lib/format";
import { resolveSubWork } from "@/lib/domain/sub-work";
import {
  buildCallGuide,
  guideProgress,
  type CallQuestion,
} from "@/lib/domain/call-guide";
import { useToast } from "@/components/toaster";
import { ContactQuickEdit } from "@/components/contact-quick-edit";
import { CallAnswer, type AnswerValue } from "@/components/call-answer";
import { ScannableText } from "@/components/scannable-text";
import { UnsavedGuard } from "@/components/unsaved-guard";

type Attachment = { name?: string; url?: string; storage_path?: string } & Record<
  string,
  unknown
>;

interface Comm {
  id: string;
  channel: string;
  direction: string;
  subject: string | null;
  body: string | null;
  created_at: string;
  replied_at: string | null;
}

interface Quote {
  id: string;
  trade: string | null;
  quote_amount: number;
  payment_terms: string | null;
  is_out_of_range: boolean | null;
  created_at: string;
}

export interface CallWorkspaceData {
  card: CallCardRow;
  communications: Comm[];
  quotes: Quote[];
  /** Who the operator is, for the spoken opener. Absent on a bare profile. */
  caller?: { name: string | null; company: string | null } | null;
}

/** Answers whose ids are also columns the rest of the platform reads. */
const CORE_TEXT_KEYS = [
  "can_perform",
  "interested",
  "bid_submitted",
  "quote_amount",
  "price_type",
  "start_date",
  "availability",
  "assumptions",
] as const;

const CORE_BOOL_KEYS = [
  "insurance_confirmed",
  "bonding_confirmed",
  "certs_confirmed",
] as const;

interface WrapUp {
  outcome: string;
  recommendation: string;
  confidence: number;
  followup_required: boolean;
  followup_date: string;
  followup_reason: string;
  notes: string;
}

function initialAnswers(card: CallCardRow): Record<string, AnswerValue> {
  const prev = (card.response_json ?? {}) as Record<string, unknown>;
  const saved = (prev.answers ?? {}) as Record<string, AnswerValue>;
  const out: Record<string, AnswerValue> = { ...saved };
  for (const k of CORE_TEXT_KEYS) {
    if (prev[k] != null && prev[k] !== "") out[k] = prev[k] as AnswerValue;
  }
  for (const k of CORE_BOOL_KEYS) {
    if (prev[k] === true) out[k] = "yes";
  }
  if (out.quote_amount == null && card.quote_amount != null) {
    out.quote_amount = String(card.quote_amount);
  }
  return out;
}

function initialWrapUp(card: CallCardRow): WrapUp {
  const prev = (card.response_json ?? {}) as Record<string, unknown>;
  return {
    outcome: (prev.outcome as string) ?? "",
    recommendation: (prev.recommendation as string) ?? "",
    confidence: typeof prev.confidence === "number" ? prev.confidence : 3,
    followup_required: Boolean(prev.followup_required),
    followup_date: (prev.followup_date as string) ?? "",
    followup_reason: (prev.followup_reason as string) ?? "",
    notes: (prev.notes as string) ?? "",
  };
}

export function CallWorkspace({
  data,
  onClose,
  variant = "overlay",
}: {
  data: CallWorkspaceData;
  onClose: () => void;
  /**
   * "inline" drops the backdrop and the dialog semantics so the call can sit
   * beside the queue rather than on top of it. Only the frame differs.
   */
  variant?: "overlay" | "inline";
}) {
  const router = useRouter();
  const { push } = useToast();
  const { communications, quotes } = data;
  const [card, setCard] = useState<CallCardRow>(data.card);
  const [answers, setAnswers] = useState(() => initialAnswers(card));
  const [wrap, setWrap] = useState<WrapUp>(() => initialWrapUp(card));
  /*
   * Notes taken during a call and a price somebody read out are the worst
   * things in this product to lose: the subcontractor has hung up, and asking
   * again means another call. Compared against the saved card, so a save
   * clears it without anything having to remember to.
   */
  const dirty =
    JSON.stringify(answers) !== JSON.stringify(initialAnswers(card)) ||
    JSON.stringify(wrap) !== JSON.stringify(initialWrapUp(card));
  const [briefOpen, setBriefOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [nextCall, setNextCall] = useState<{ id: string; company_name: string } | null>(null);
  const [completed, setCompleted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [noAnswerBusy, setNoAnswerBusy] = useState(false);

  const analysis = (card.solicitation_analysis ?? {}) as Record<string, unknown>;
  const quals = (analysis.qualifications ?? {}) as Record<string, unknown>;
  const list = (k: string): string[] =>
    Array.isArray(quals[k]) ? (quals[k] as string[]) : [];
  const requiredCerts = list("certifications");
  const requiredLicenses = list("licenses");
  const requiredInsurance = list("insurance");
  const requiredBonding = list("bonding");

  const subWork = resolveSubWork({
    trade: card.trade,
    analysis,
    description: card.description,
  });

  /**
   * What has actually passed between us, read from the record rather than
   * assumed from why the card exists. A card is created when outreach is
   * queued, but the email can stay a draft or fail to send, and opening with
   * "I sent you an email recently" to somebody who never got one is exactly
   * how a call starts badly.
   */
  const priorContact: "replied" | "emailed" | "none" = communications.some(
    (c) => c.direction === "inbound"
  )
    ? "replied"
    : card.source === "reply"
      ? "replied"
      : communications.some((c) => c.direction === "outbound" && c.channel === "email")
        ? "emailed"
        : "none";

  const guide = useMemo(
    () =>
      buildCallGuide({
        companyName: card.company_name,
        ownerName: card.owner_name,
        callerName: data.caller?.name ?? null,
        callerCompany: data.caller?.company ?? null,
        trade: card.trade,
        opportunityTitle: card.opportunity_title,
        agency: card.agency,
        locationLabel:
          [card.opportunity_location, card.location_state].filter(Boolean).join(", ") ||
          null,
        source: card.source,
        priorContact,
        work: subWork.work,
        requires: {
          // Insurance is asked unless the guide is told otherwise: federal
          // subcontracts effectively always require it, and the analyst only
          // enumerates it when the solicitation spells it out.
          bonding: requiredBonding.length > 0,
          licenses: requiredLicenses.length > 0,
          certifications: requiredCerts.length > 0,
        },
        needsProjectHistory: card.needs_project_history,
        generated: card.question_list,
        emailMentionedPrice:
          typeof (card.card_json as Record<string, unknown>)?.email_mentioned_price ===
          "number"
            ? ((card.card_json as Record<string, unknown>).email_mentioned_price as number)
            : null,
      }),
    // The guide is derived from the card, which only changes on a contact edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [card, data.caller, priorContact]
  );

  const progress = guideProgress(guide, answers);
  const attachments: Attachment[] = Array.isArray(card.attachments_json)
    ? (card.attachments_json as Attachment[])
    : [];

  async function copyPhone() {
    if (!card.phone) return;
    try {
      await navigator.clipboard.writeText(card.phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable; the number is visible either way */
    }
  }

  /** One tap for the most common outcome: nobody picked up. */
  async function noAnswer() {
    setNoAnswerBusy(true);
    try {
      const res = await fetch("/api/snooze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "call_card", id: card.id, until: "tomorrow" }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Could not schedule the retry.");
        return;
      }
      push({
        message: `No answer logged for ${card.company_name}. The call returns tomorrow morning.`,
        undo: { endpoint: "/api/snooze", body: { kind: "call_card", id: card.id, until: null } },
      });
      router.refresh();
      onClose();
    } finally {
      setNoAnswerBusy(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function setAnswer(id: string, v: AnswerValue) {
    setAnswers((a) => ({ ...a, [id]: v }));
  }

  /**
   * Split the flat answer map back into the shape the rest of the platform
   * reads: the core keys stay top-level (quotes, coverage and the reply
   * pipeline all key off them), everything job-specific rides in `answers`.
   */
  function buildPayload() {
    const core: Record<string, unknown> = {};
    const rest: Record<string, AnswerValue> = {};
    const coreIds = new Set<string>([...CORE_TEXT_KEYS, ...CORE_BOOL_KEYS]);
    for (const [k, v] of Object.entries(answers)) {
      if (!coreIds.has(k)) rest[k] = v;
    }
    for (const k of CORE_TEXT_KEYS) core[k] = answers[k] ?? "";
    for (const k of CORE_BOOL_KEYS) core[k] = answers[k] === "yes";
    return {
      ...core,
      ...wrap,
      answers: rest,
      // Kept so a reader of the raw record can tell which questions were put
      // to this sub, not just what came back.
      questions_asked: guide.sections.flatMap((s) =>
        s.questions.map((q) => ({ id: q.id, ask: q.ask }))
      ),
    };
  }

  async function save(closeAfter: boolean) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/call-cards/${card.id}/save-workspace`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: buildPayload(), closeCard: closeAfter }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Save failed. Try again.");
        setSaving(false);
        return;
      }
      setSavedOk(true);
      if (closeAfter) {
        // Don't refresh yet: it unmounts this workspace before the "next call"
        // bar can show. The refresh happens on Done or Next.
        const next = (body as { nextCall?: { id: string; company_name: string } | null })
          .nextCall;
        if (next) {
          setNextCall(next);
          setCompleted(true);
        } else {
          push({ message: "Call saved. That was the last call in the queue. 🎉" });
          router.refresh();
          setTimeout(onClose, 400);
        }
      } else {
        router.refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const chips = [
    card.agency,
    card.value_estimated != null ? currency(card.value_estimated) : null,
    card.deadline ? `Due ${shortDate(card.deadline)}` : null,
    [card.opportunity_location, card.location_state].filter(Boolean).join(", ") || null,
  ].filter(Boolean) as string[];

  /*
   * Two shapes, one workspace.
   *
   * Inline is the desktop Call Queue, where the audit asks for a permanent
   * split: the list stays on the left and the call lives beside it, so
   * finishing one call and starting the next never closes and reopens a
   * dialog. Overlay is everywhere else, and on a phone, where a call has to
   * be the whole screen.
   *
   * The difference is deliberately only the frame. Making the inline one a
   * separate component would be two copies of a twenty-field form, and the
   * copy that gets fixed is never the one somebody is using.
   */
  const inline = variant === "inline";
  const body = (
      <aside
        onClick={inline ? undefined : (e) => e.stopPropagation()}
        className={
          inline
            ? "scroll-thin flex h-full w-full flex-col overflow-y-auto bg-background"
            : "scroll-thin flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-background shadow-2xl"
        }
        role={inline ? "region" : "dialog"}
        aria-modal={inline ? undefined : true}
        aria-label={`Call workspace for ${card.company_name}`}
      >
        <UnsavedGuard
          when={dirty}
          message="This call has notes or a price that are not saved yet. Leave without saving?"
        />
        {/* Who, what, and the dial button. Nothing else competes for the top. */}
        <header className="sticky top-0 z-10 border-b border-border bg-background/95 px-4 py-2.5 backdrop-blur sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-display text-lg font-semibold text-foreground">
                {card.company_name}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {[card.trade, card.owner_name, card.opportunity_title]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              /* The way out of a full-screen workspace on a phone, and it was
                 27 pixels wide. */
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-surface md:min-h-0 md:min-w-0 md:p-1.5"
            >
              ✕
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {card.phone && (
              <a href={`tel:${card.phone}`} className="btn-primary inline-flex items-center gap-2">
                📞 {card.phone}
              </a>
            )}
            {card.phone && (
              <button type="button" onClick={() => void copyPhone()} className="btn-ghost text-xs">
                {copied ? "✓ Copied" : "Copy"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void noAnswer()}
              disabled={noAnswerBusy}
              className="btn-ghost text-xs"
              title="Logs the attempt and brings this call back tomorrow morning"
            >
              {noAnswerBusy ? "Scheduling…" : "No answer"}
            </button>
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              {progress.answered}/{progress.total} captured
            </span>
          </div>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          {/* Everything about the job, one line and a disclosure. Read before
              dialling; never in the way during the call. */}
          <section className="rounded-md border border-border bg-surface/40">
            <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded bg-surface px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {c}
                </span>
              ))}
              <button
                type="button"
                onClick={() => setBriefOpen((o) => !o)}
                /*
                 * This opens the job details mid-call, and it was 28 by 16.
                 * The height is fixed by min-h-11; the width needs its own
                 * floor, because the label is one short word and a text
                 * button is only as wide as its text.
                 */
                className="ml-auto inline-flex min-h-11 min-w-11 items-center justify-end text-xs font-medium text-accent-strong hover:underline md:min-h-0 md:min-w-0"
                aria-expanded={briefOpen}
              >
                {briefOpen ? "Hide brief" : "Brief"}
              </button>
            </div>

            {briefOpen && (
              <div className="space-y-3 border-t border-border px-3 py-3 text-sm">
                {subWork.work && (
                  <Block label="What we need them to do">
                    <ScannableText text={subWork.work} className="text-foreground" />
                  </Block>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  {card.solicitation_number && (
                    <Block label="Solicitation">
                      <span className="text-foreground">{card.solicitation_number}</span>
                    </Block>
                  )}
                  {card.naics_code && (
                    <Block label="NAICS">
                      <span className="text-foreground">{card.naics_code}</span>
                    </Block>
                  )}
                  {card.set_aside_type && (
                    <Block label="Set-aside">
                      <span className="text-foreground">{card.set_aside_type}</span>
                    </Block>
                  )}
                </div>
                {(requiredCerts.length > 0 ||
                  requiredLicenses.length > 0 ||
                  requiredInsurance.length > 0 ||
                  requiredBonding.length > 0) && (
                  <Block label="Job requires">
                    <ul className="flex flex-wrap gap-1.5">
                      {[
                        ...requiredCerts,
                        ...requiredLicenses,
                        ...requiredInsurance,
                        ...requiredBonding,
                      ].map((r, i) => (
                        <li
                          key={i}
                          className="rounded bg-surface px-2 py-0.5 text-xs text-muted-foreground"
                        >
                          {r}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                {attachments.length > 0 && (
                  <Block label={`Documents (${attachments.length})`}>
                    <ul className="space-y-0.5">
                      {attachments.map((a, i) => {
                        const href =
                          a.storage_path != null ? `/api/files/${a.storage_path}` : a.url;
                        const label =
                          a.name ??
                          (typeof a.storage_path === "string"
                            ? a.storage_path.split("/").pop()
                            : "Attachment");
                        return (
                          <li key={i} className="text-xs">
                            {href ? (
                              <a
                                href={href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-accent-strong hover:underline"
                              >
                                📎 {label}
                              </a>
                            ) : (
                              <span className="text-muted-foreground">📎 {label}</span>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </Block>
                )}
                {(quotes.length > 0 || communications.length > 0) && (
                  <Block label="History">
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {quotes.slice(0, 3).map((q) => (
                        <li key={q.id}>
                          {shortDate(q.created_at)} · quoted{" "}
                          <span className="tabular-nums text-foreground">
                            {currency(q.quote_amount)}
                          </span>
                          {q.trade ? ` for ${q.trade}` : ""}
                        </li>
                      ))}
                      {communications.slice(0, 3).map((c) => (
                        <li key={c.id}>
                          {shortDate(c.created_at)} · {c.channel} {c.direction}
                          {c.subject ? ` · ${c.subject}` : ""}
                        </li>
                      ))}
                    </ul>
                  </Block>
                )}
                <ContactQuickEdit
                  subId={card.subcontractor_id}
                  companyName={card.company_name}
                  email={card.email}
                  phone={card.phone}
                  website={card.website}
                  ownerName={card.owner_name}
                  onSaved={(v) => setCard((c) => ({ ...c, ...v }))}
                />
              </div>
            )}
          </section>

          {/* The only prose on the screen, and it is marked as words to say. */}
          <SpeakLine label="Open with">{guide.opener}</SpeakLine>

          {guide.sections.map((section) => (
            <section key={section.id}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {section.title}
              </h3>
              <div className="divide-y divide-border panel-inset px-3">
                {section.questions.map((q: CallQuestion) => (
                  <CallAnswer
                    key={q.id}
                    question={q}
                    value={answers[q.id] ?? null}
                    onChange={(v) => setAnswer(q.id, v)}
                  />
                ))}
              </div>
            </section>
          ))}

          <SpeakLine label="Close with">{guide.closer}</SpeakLine>

          {/* After the call. Separated because none of it is asked aloud. */}
          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              After you hang up
            </h3>
            <div className="space-y-3 panel-inset p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Outcome">
                  <select
                    className="input w-full"
                    value={wrap.outcome}
                    onChange={(e) => setWrap((w) => ({ ...w, outcome: e.target.value }))}
                  >
                    <option value="">-</option>
                    <option value="success">Got a quote</option>
                    <option value="no_answer">No answer</option>
                    <option value="not_interested">Not interested</option>
                    <option value="declined">Declined to bid</option>
                    <option value="skipped">Chose not to call</option>
                  </select>
                </Field>
                <Field label="Use them?">
                  <select
                    className="input w-full"
                    value={wrap.recommendation}
                    onChange={(e) =>
                      setWrap((w) => ({ ...w, recommendation: e.target.value }))
                    }
                  >
                    <option value="">-</option>
                    <option value="recommend">Recommend</option>
                    <option value="backup">Backup</option>
                    <option value="reject">Not a fit</option>
                  </select>
                </Field>
              </div>
              <Field label="Confidence">
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setWrap((w) => ({ ...w, confidence: n }))}
                      aria-pressed={wrap.confidence === n}
                      /*
                       * 44 on a phone, because this is the last thing typed
                       * before Complete call and the five targets sit side by
                       * side: at 36 a slip records a different confidence in
                       * a subcontractor, which is what later sourcing reads.
                       */
                      className={`min-h-11 flex-1 rounded-md border text-sm md:h-9 md:min-h-0 ${
                        wrap.confidence === n
                          ? "border-accent bg-accent-soft text-accent-strong"
                          : "border-border text-muted-foreground hover:bg-surface"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-accent"
                  checked={wrap.followup_required}
                  onChange={(e) =>
                    setWrap((w) => ({ ...w, followup_required: e.target.checked }))
                  }
                />
                Needs a follow-up
              </label>
              {wrap.followup_required && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="When">
                    <input
                      type="date"
                      className="input w-full"
                      value={wrap.followup_date}
                      onChange={(e) =>
                        setWrap((w) => ({ ...w, followup_date: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Why">
                    <input
                      type="text"
                      className="input w-full"
                      value={wrap.followup_reason}
                      onChange={(e) =>
                        setWrap((w) => ({ ...w, followup_reason: e.target.value }))
                      }
                      placeholder="Waiting on drawings"
                    />
                  </Field>
                </div>
              )}
              <Field label="Notes">
                <textarea
                  rows={2}
                  className="input min-h-[52px] w-full resize-y"
                  value={wrap.notes}
                  onChange={(e) => setWrap((w) => ({ ...w, notes: e.target.value }))}
                  placeholder="Anything worth knowing next time"
                />
              </Field>
            </div>
          </section>

          {error && (
            <p className="rounded-md border border-risk/40 bg-risk/5 px-3 py-2 text-sm text-risk">
              {error}
            </p>
          )}
          {savedOk && !completed && (
            <p className="rounded-md border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent-strong">
              Saved. Related records updated.
            </p>
          )}
        </div>

        <footer className="sticky bottom-0 z-10 border-t border-border bg-background/95 px-4 py-2.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:px-5">
          {completed && nextCall ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-pursue">✓ Saved. All records updated.</p>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    router.refresh();
                    onClose();
                  }}
                  className="btn-ghost"
                >
                  Done for now
                </button>
                <button
                  onClick={() => {
                    onClose();
                    router.push(`/call-queue?open=${nextCall.id}`);
                    router.refresh();
                  }}
                  className="btn-primary"
                >
                  Next: {nextCall.company_name} →
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <button onClick={onClose} className="btn-ghost" disabled={saving}>
                Cancel
              </button>
              <div className="flex gap-2">
                <button onClick={() => save(false)} className="btn-ghost" disabled={saving}>
                  {saving ? "Saving…" : "Save draft"}
                </button>
                <button onClick={() => save(true)} className="btn-primary" disabled={saving}>
                  {saving ? "Saving…" : "Complete call"}
                </button>
              </div>
            </div>
          )}
        </footer>
      </aside>
  );

  if (inline) return body;
  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-black/40"
      onClick={onClose}
      role="presentation"
    >
      {body}
    </div>
  );
}

/* ---------- Small presentational helpers ---------- */

/** The two lines that are actually spoken, visually distinct from questions. */
function SpeakLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <p className="rounded-md border border-pursue/30 bg-pursue/5 px-3 py-2 text-sm leading-snug text-foreground">
      <span className="mr-2 text-xs font-semibold uppercase tracking-wider text-pursue">
        {label}
      </span>
      {children}
    </p>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-0.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}
