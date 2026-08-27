"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TokenPalette } from "@/components/token-palette";
import { UnsavedGuard } from "@/components/unsaved-guard";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { plainToHtml, renderTemplate } from "@/lib/domain/template-render";
import {
  TEMPLATE_TOKENS,
  TEMPLATE_TOKEN_SAMPLES,
  previewBriefSections,
} from "@/lib/domain/template-tokens";
import {
  toggleBulletLines,
  wrapHighlightLines,
  wrapSelection,
} from "@/lib/domain/template-markup";
import { renderOutreachBrief } from "@/lib/domain/outreach-email";
import { buildOutreachSections } from "@/lib/domain/outreach-sections";
import { validateTemplate } from "@/lib/domain/outreach-validation";
import {
  deliverabilityFindings,
  formatMetric,
  openRateLabel,
  metricsSummary,
  OPEN_RATE_CAVEAT,
  type TemplateMetrics,
} from "@/lib/domain/template-health";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EmailTemplate {
  id: string;
  slug: string;
  version: number;
  subject: string | null;
  body: string;
  description: string | null;
  /**
   * False when this account is still on the wording the platform ships with.
   *
   * It changes what every sentence on this card can honestly say. Without it
   * the page reports "version 1 was saved, you keep receiving version 1",
   * which is two different rows with the same number and reads as a bug.
   */
  ownedByOrg?: boolean;
}

interface TemplateVersion {
  id: string;
  version: number;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
  status?: "draft" | "published";
}

/**
 * A saved edit that is not being sent yet.
 *
 * Shaped for the browser rather than reusing the database row, so this file
 * stays free of anything that would drag a database connection into the
 * client bundle.
 */
export interface TemplateDraftView {
  version: number;
  subject: string | null;
  body: string;
  draftedAt: string;
  /** Who saved it, or null on a draft written before this was recorded. */
  draftedBy: string | null;
}

function previewFilled(template: string): string {
  return renderTemplate(template, TEMPLATE_TOKEN_SAMPLES);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function humanSlug(slug: string): string {
  if (slug === "template_1_outreach") return "Initial outreach email";
  if (slug === "template_2_followup") return "48-hour follow-up, reply in the thread";
  if (slug === "template_2_followup_new_thread")
    return "48-hour follow-up, new email (fallback)";
  return slug.replace(/_/g, " ");
}

/**
 * When this template is used, and what rides along with it.
 *
 * The two follow-up bodies are the reason this exists. An operator looking at
 * two similar-looking follow-ups has no way to know that one of them is only
 * ever sent when threading fails, that one inherits its subject and the other
 * does not, or that only one carries the attachments. Editing the wrong one is
 * silent: the change simply never appears in any email anyone receives.
 */
export function slugGuidance(
  slug: string,
  /**
   * The account's own follow-up window. Typed into this sentence as "48
   * hours" until it became a setting, at which point every operator who
   * changed it was reading guidance about somebody else's account.
   */
  followupHours: number
): { when: string; subject: string; attachments: string } | null {
  if (slug === "template_1_outreach") {
    return {
      when: "Sent once, when a subcontractor clears verification for a trade on a solicitation.",
      subject: "Yours, as written below.",
      attachments:
        "Every bid document for this trade is attached. The project, scope, requirements, questions, quote checklist and document list are added automatically beneath your text.",
    };
  }
  if (slug === "template_2_followup") {
    return {
      when: `Sent ${followupHours} hour${followupHours === 1 ? "" : "s"} later, as a reply inside the original conversation, when nobody has answered.`,
      subject:
        "Inherited from the original email. There is no subject field here because a reply must keep the thread's subject to stay in it.",
      attachments:
        "None, and no scope. Both are directly above this message in the same conversation, so repeating them turns a short nudge into a wall of text.",
    };
  }
  if (slug === "template_2_followup_new_thread") {
    return {
      when: "Used only when the original thread cannot be replied to, so this arrives as a separate email.",
      subject: "Yours, as written below, because there is no thread to inherit one from.",
      attachments:
        "The full document package and all generated sections, because the recipient has nothing above this message to refer back to.",
    };
  }
  return null;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Insert text at the cursor position of a textarea. */
function spliceIntoTextarea(
  el: HTMLTextAreaElement,
  current: string,
  token: string
): { next: string; cursor: number } {
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  return { next, cursor: start + token.length };
}

/** Insert text at the cursor position of an input. */
function spliceIntoInput(
  el: HTMLInputElement,
  current: string,
  token: string
): { next: string; cursor: number } {
  const start = el.selectionStart ?? current.length;
  const end = el.selectionEnd ?? current.length;
  const next = current.slice(0, start) + token + current.slice(end);
  return { next, cursor: start + token.length };
}


// ---------------------------------------------------------------------------
// Version History section
// ---------------------------------------------------------------------------

interface VersionHistoryProps {
  slug: string;
  /** The version actually being sent, so "in use" is not guessed from order. */
  publishedVersion: number;
  /** Bumped by the parent after a publish or discard so a reopened list
   *  is refetched rather than served from the stale cache below. */
  refreshKey: number;
  onRestored: (newVersion: number, subject: string | null, body: string) => void;
}

function VersionHistory({
  slug,
  publishedVersion,
  refreshKey,
  onRestored,
}: VersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<TemplateVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  /*
   * The list is cached until something changes it. refreshKey is how the
   * parent says so: after a publish, the row that was a draft is now the one
   * in use, and a cached list would keep calling it a draft.
   */
  const [loadedKey, setLoadedKey] = useState<number | null>(null);

  useEffect(() => {
    if (loadedKey !== null && loadedKey !== refreshKey) {
      setVersions(null);
      setLoadedKey(null);
      setExpandedId(null);
    }
  }, [refreshKey, loadedKey]);

  async function load() {
    if (versions !== null) return; // already loaded
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${slug}?history=true`);
      const data = (await res.json().catch(() => ({}))) as {
        versions?: TemplateVersion[];
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Failed to load history");
      } else {
        setVersions(data.versions ?? []);
        setLoadedKey(refreshKey);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) load();
  }

  async function restore(v: TemplateVersion) {
    setRestoringId(v.id);
    setRestoreMsg(null);
    try {
      const res = await fetch(`/api/templates/${slug}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: v.version }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        version?: number;
        subject?: string | null;
        body?: string;
        error?: string;
      };
      if (!res.ok) {
        setRestoreMsg(`Error: ${data.error ?? "Restore failed"}`);
      } else {
        const newVer = data.version ?? publishedVersion + 1;
        setRestoreMsg(
          `Saved as draft version ${newVer}. Publish it to start sending it.`
        );
        onRestored(newVer, data.subject ?? null, data.body ?? v.body);
        // Invalidate cache so next open re-fetches
        setVersions(null);
        setTimeout(() => setRestoreMsg(null), 6000);
      }
    } catch (e) {
      setRestoreMsg(`Error: ${(e as Error).message}`);
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-left lg:min-h-0"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-slate-700">
          Version history
        </span>
        <span className="text-slate-500 text-xs select-none">
          {open ? "▲ collapse" : "▼ expand"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {loading && (
            <p className="text-xs text-slate-500">Loading versions…</p>
          )}
          {error && <p className="text-xs text-risk">{error}</p>}
          {restoreMsg && (
            <p
              className={`text-xs font-medium ${
                restoreMsg.startsWith("Error:")
                  ? "text-risk"
                  : "text-pursue"
              }`}
            >
              {restoreMsg.startsWith("Error:") ? "" : "✓ "}{restoreMsg}
            </p>
          )}
          {versions !== null && versions.length === 0 && (
            <p className="text-xs text-slate-500">No saved versions yet.</p>
          )}
          {versions !== null &&
            versions.map((v) => {
              const isExpanded = expandedId === v.id;
              const isRestoring = restoringId === v.id;
              const isCurrent = v.is_active;
              const isDraft = v.status === "draft";

              return (
                <div
                  key={v.id}
                  className="rounded-lg border border-border bg-surface"
                >
                  {/* Version row header */}
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left"
                    onClick={() =>
                      setExpandedId(isExpanded ? null : v.id)
                    }
                  >
                    <span className="text-xs font-mono font-semibold text-slate-700 shrink-0">
                      v{v.version}
                    </span>
                    {isCurrent && (
                      <span className="shrink-0 rounded-full bg-pursue/15 px-2 py-0.5 text-[10px] font-semibold text-pursue-strong">
                        in use
                      </span>
                    )}
                    {isDraft && (
                      <span className="shrink-0 rounded-full bg-review/15 px-2 py-0.5 text-[10px] font-semibold text-review">
                        draft, not sent
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                      {v.subject
                        ? v.subject
                        : <em className="text-slate-500">(no subject)</em>}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {formatDate(v.created_at)}
                    </span>
                    <span className="shrink-0 text-slate-500 text-xs select-none">
                      {isExpanded ? "▲" : "▼"}
                    </span>
                  </button>

                  {/* Expanded read-only view */}
                  {isExpanded && (
                    <div className="border-t border-border px-4 py-3 space-y-3">
                      <div>
                        <p className="label mb-1 text-xs">Subject</p>
                        <p className="rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap dark:border-white/10">
                          {v.subject || <em className="text-muted-foreground">(no subject)</em>}
                        </p>
                      </div>
                      <div>
                        <p className="label mb-1 text-xs">Body</p>
                        <p className="max-h-48 overflow-y-auto rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs text-foreground whitespace-pre-wrap leading-relaxed scroll-thin dark:border-white/10">
                          {v.body}
                        </p>
                      </div>
                      {/* Neither the version in use nor the draft itself can
                          be restored: one is already what is being sent, and
                          the other is already the draft that restoring would
                          write. */}
                      {!isCurrent && !isDraft && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => restore(v)}
                          disabled={isRestoring}
                        >
                          {isRestoring ? "Restoring…" : "Restore this version as a draft"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  template: EmailTemplate;
  /** What this template has actually done, when it has done anything. */
  metrics: TemplateMetrics;
  /** From this account's automation rules, so the guidance is not a guess. */
  followupHours: number;
  /**
   * A saved edit waiting to be published, if there is one.
   *
   * Null means the wording below is exactly what the platform is sending.
   */
  draft?: TemplateDraftView | null;
  /**
   * Told whenever the draft appears or goes away.
   *
   * The list beside this editor has to say which templates have an
   * unpublished draft. Without this it would keep reporting the state the
   * page was rendered with, so the template you just saved would be the one
   * the list still called up to date.
   */
  onDraftChange?: (slug: string, draft: TemplateDraftView | null) => void;
}

/**
 * Edit one outreach template. Shows the subject + body with a draggable /
 * clickable token palette and a preview modal with sample values filled in.
 */
export function EmailTemplateEditor({
  template,
  metrics,
  followupHours,
  draft = null,
  onDraftChange,
}: Props) {
  /*
   * The draft that is waiting, if one is.
   *
   * The editor opens on the draft rather than on the published wording,
   * because somebody who saved an edit yesterday and came back today is here
   * to finish it, and opening on the live text would silently discard their
   * work the next time they pressed Save.
   */
  const [pending, setPending] = useState<TemplateDraftView | null>(draft);
  const [subject, setSubject] = useState((draft ?? template).subject ?? "");
  const [body, setBody] = useState((draft ?? template).body);
  /*
   * Derived rather than tracked with a flag: the saved text is right there,
   * so comparing is both simpler and correct after a save, where a flag has
   * to be remembered to be cleared.
   *
   * Compared against the draft when one exists. Comparing against the
   * published wording instead would leave the page permanently claiming
   * unsaved changes for anyone with a draft open.
   */
  const saved = pending ?? { subject: template.subject, body: template.body };
  const dirty = subject !== (saved.subject ?? "") || body !== saved.body;

  /*
   * What is actually going out right now.
   *
   * Held separately from the editor fields for one reason: the operator has
   * to be able to see the live wording while looking at their unpublished
   * edit, or "publish" is a decision made blind.
   */
  const liveSubject = template.subject ?? "";
  const liveBody = template.body;
  const draftDiffers =
    pending !== null &&
    ((pending.subject ?? "") !== liveSubject || pending.body !== liveBody);
  const [showLive, setShowLive] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardBusy, setDiscardBusy] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState(template.version);
  /*
   * Whether the version in use is this account's own.
   *
   * Tracked in state because publishing changes it: the moment an org
   * publishes its first draft it stops inheriting the platform wording, and
   * the sentences below have to stop saying that it does.
   */
  const [owned, setOwned] = useState(template.ownedByOrg !== false);
  /** Bumped after publish or discard so the version list refetches. */
  const [historyKey, setHistoryKey] = useState(0);
  const [publishNotice, setPublishNotice] = useState<string | null>(null);

  /*
   * Checked as they type, not only on save.
   *
   * A mistyped field name renders as literal "{{trade_name}}" in a real
   * subcontractor's inbox, and the send path refuses it, which means the
   * operator's next signal is an opportunity that quietly stops sending. The
   * same check runs on the server; this one just moves the news forward to the
   * moment the mistake is made.
   */
  const problems = useMemo(
    () => validateTemplate({ subject, body }),
    [subject, body]
  );
  /*
   * Whether it will land, as distinct from whether it is correct.
   *
   * The problems above are refusals: a template with an unknown variable
   * cannot be saved. These are not. A subject in block capitals is legal and
   * ill-advised, and the operator is the one who decides. Separating the two
   * matters, because a warning shown with the same weight as a refusal is
   * either ignored or obeyed, and both are wrong.
   */
  const delivery = useMemo(
    () => deliverabilityFindings({ subject, body }),
    [subject, body]
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  /*
   * Preview against a record the operator actually holds.
   *
   * Rendering against the sample values proves the SHAPE of an email and
   * nothing about whether it can be sent: the samples are complete by
   * construction, so that preview is always perfect, and every gap that
   * really stops a send stays invisible until a live opportunity reaches the
   * outreach agent at 3am.
   */
  type Pairing = {
    opportunity_id: string;
    subcontractor_id: string;
    trade: string | null;
    opportunity_title: string | null;
    company_name: string;
  };
  type RealContext = {
    vars: Record<string, string>;
    scopeBoundary: string;
    missingRequired: string[];
    warnings: string[];
    attachedNames: string[];
  };
  const [pairings, setPairings] = useState<Pairing[]>([]);
  /** True when no outreach exists yet and these pairs were matched by trade. */
  const [pairsAreHypothetical, setPairsAreHypothetical] = useState(false);
  const [pairKey, setPairKey] = useState("");
  const [realCtx, setRealCtx] = useState<RealContext | null>(null);
  const [ctxBusy, setCtxBusy] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);

  async function loadPairings() {
    if (pairings.length) return;
    try {
      const res = await fetch("/api/templates/preview-context?list=1");
      const data = (await res.json()) as { pairings?: Pairing[]; synthesized?: boolean };
      setPairings(data.pairings ?? []);
      setPairsAreHypothetical(Boolean(data.synthesized));
    } catch {
      // A preview that cannot list real work still previews with samples.
    }
  }

  async function loadRealContext(key: string) {
    setPairKey(key);
    setCtxError(null);
    if (!key) {
      setRealCtx(null);
      return;
    }
    const [opportunityId, subcontractorId, trade] = key.split("|");
    setCtxBusy(true);
    try {
      const res = await fetch(
        `/api/templates/preview-context?opportunityId=${encodeURIComponent(opportunityId)}` +
          `&subcontractorId=${encodeURIComponent(subcontractorId)}` +
          (trade ? `&trade=${encodeURIComponent(trade)}` : "")
      );
      const data = (await res.json()) as RealContext & { error?: string };
      if (!res.ok) {
        setCtxError(data.error ?? "Could not load that record.");
        setRealCtx(null);
        return;
      }
      setRealCtx(data);
    } catch (e) {
      setCtxError((e as Error).message);
      setRealCtx(null);
    } finally {
      setCtxBusy(false);
    }
  }
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; email?: string; error?: string } | null>(null);

  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Track which field last had focus so token clicks land in the right place.
  const lastFocused = useRef<"subject" | "body">("body");

  // -------------------------------------------------------------------------
  // Token insertion
  // -------------------------------------------------------------------------

  function insertToken(key: string) {
    const token = `{{${key}}}`;

    if (lastFocused.current === "subject" && subjectRef.current) {
      const el = subjectRef.current;
      const { next, cursor } = spliceIntoInput(el, subject, token);
      setSubject(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(cursor, cursor);
        el.focus();
      });
    } else if (bodyRef.current) {
      const el = bodyRef.current;
      const { next, cursor } = spliceIntoTextarea(el, body, token);
      setBody(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(cursor, cursor);
        el.focus();
      });
    }
  }

  function onDropSubject(e: React.DragEvent<HTMLInputElement>) {
    const text = e.dataTransfer.getData("text/plain");
    const match = text.match(/^\{\{(\w+)\}\}$/);
    if (!match) return;
    e.preventDefault();
    lastFocused.current = "subject";
    insertToken(match[1]);
  }

  function onDropBody(e: React.DragEvent<HTMLTextAreaElement>) {
    const text = e.dataTransfer.getData("text/plain");
    const match = text.match(/^\{\{(\w+)\}\}$/);
    if (!match) return;
    e.preventDefault();
    lastFocused.current = "body";
    insertToken(match[1]);
  }

  function applyBodyEdit(
    edit: (el: HTMLTextAreaElement, current: string) => {
      next: string;
      selectStart: number;
      selectEnd: number;
    }
  ) {
    const el = bodyRef.current;
    if (!el) return;
    lastFocused.current = "body";
    const { next, selectStart, selectEnd } = edit(el, body);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selectStart, selectEnd);
    });
  }

  function formatBold() {
    applyBodyEdit((el, current) =>
      wrapSelection(
        current,
        el.selectionStart ?? current.length,
        el.selectionEnd ?? current.length,
        "**",
        "**",
        "bold text"
      )
    );
  }

  function formatHighlight() {
    applyBodyEdit((el, current) =>
      wrapHighlightLines(
        current,
        el.selectionStart ?? current.length,
        el.selectionEnd ?? current.length
      )
    );
  }

  function formatBullets() {
    applyBodyEdit((el, current) =>
      toggleBulletLines(
        current,
        el.selectionStart ?? 0,
        el.selectionEnd ?? 0
      )
    );
  }

  // -------------------------------------------------------------------------
  // Send test email
  // -------------------------------------------------------------------------

  async function sendTestEmail() {
    setTestResult(null);
    setTestBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        sentTo?: string;
        error?: string;
      };
      if (!res.ok) {
        setTestResult({ ok: false, error: data.error ?? "Send failed" });
      } else {
        setTestResult({ ok: true, email: data.sentTo });
        setTimeout(() => setTestResult(null), 8000);
      }
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message });
    } finally {
      setTestBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        version?: number;
        draft?: TemplateDraftView;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      const newVer = data.version ?? publishedVersion + 1;
      const nextDraft: TemplateDraftView = data.draft ?? {
        version: newVer,
        subject: subject || null,
        body,
        draftedAt: new Date().toISOString(),
        draftedBy: null,
      };
      setPending(nextDraft);
      onDraftChange?.(template.slug, nextDraft);
      setSavedVersion(newVer);
      setTimeout(() => setSavedVersion(null), 6000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Publish and discard
  // -------------------------------------------------------------------------

  /**
   * Put the saved draft into use.
   *
   * Deliberately publishes what was saved rather than what is on screen. If
   * the two differ the button is held back with a reason, because publishing
   * text the operator can see, but that is not the text that would go out, is
   * the worst version of this control.
   */
  async function publish() {
    setError(null);
    setPublishNotice(null);
    setPublishBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.slug}/publish`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        version?: number;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Publish failed");
        return;
      }
      const ver = data.version ?? pending?.version ?? publishedVersion;
      setPublishedVersion(ver);
      setOwned(true);
      setPending(null);
      onDraftChange?.(template.slug, null);
      setShowLive(false);
      setHistoryKey((k) => k + 1);
      setPublishNotice(
        `Version ${ver} is now in use. Outreach sent from here on uses this wording.`
      );
      setTimeout(() => setPublishNotice(null), 8000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPublishBusy(false);
    }
  }

  /** Throw the draft away and put the editor back on the live wording. */
  async function discard() {
    setError(null);
    setDiscardBusy(true);
    try {
      const res = await fetch(`/api/templates/${template.slug}/discard`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Could not discard that draft");
        return;
      }
      setPending(null);
      onDraftChange?.(template.slug, null);
      setSubject(liveSubject);
      setBody(liveBody);
      setShowLive(false);
      setDiscardOpen(false);
      setHistoryKey((k) => k + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDiscardBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Restore callback (from VersionHistory child)
  // -------------------------------------------------------------------------

  /*
   * Restoring writes a draft, so the editor adopts it.
   *
   * It used to leave the fields alone on the reasoning that the operator
   * should choose. That reasoning stopped holding the moment restore stopped
   * going live: what is on screen and what is saved would disagree, and the
   * next Save would overwrite the restored draft with the text the operator
   * had left sitting in the box.
   */
  function handleRestored(
    newVersion: number,
    restoredSubject: string | null,
    restoredBody: string
  ) {
    setSubject(restoredSubject ?? "");
    setBody(restoredBody);
    const restoredDraft: TemplateDraftView = {
      version: newVersion,
      subject: restoredSubject,
      body: restoredBody,
      draftedAt: new Date().toISOString(),
      draftedBy: null,
    };
    setPending(restoredDraft);
    onDraftChange?.(template.slug, restoredDraft);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  /*
   * One rendering path for both modes.
   *
   * The real context supplies the same variable map the send path builds, so
   * the preview is the send path's own output rather than a second rendering
   * that happens to look similar.
   */
  const previewVars = realCtx?.vars ?? TEMPLATE_TOKEN_SAMPLES;
  const previewSections = realCtx
    ? buildOutreachSections({
        vars: realCtx.vars,
        scopeBoundary: realCtx.scopeBoundary,
        attachedNames: realCtx.attachedNames,
        links: [],
      })
    : previewBriefSections();
  const previewSubject = renderTemplate(subject || "(no subject)", previewVars);
  const previewDetails = renderOutreachBrief(previewSections);
  const previewBodyHtml =
    plainToHtml(renderTemplate(body, previewVars)) + previewDetails.html;

  return (
    <div className="card space-y-5">
      <UnsavedGuard
        when={dirty}
        message="This email template has unsaved changes. Leave without saving?"
      />
      {/* Header */}
      <div className="border-b border-border pb-4">
        <p className="font-medium text-foreground">{humanSlug(template.slug)}</p>
        {template.description && (
          <p className="mt-0.5 text-sm text-slate-500">{template.description}</p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          {owned
            ? `Version ${publishedVersion} is in use. It is what this platform sends.`
            : "The wording this platform ships with is in use. This account has not published its own version."}
        </p>
        {(() => {
          const g = slugGuidance(template.slug, followupHours);
          if (!g) return null;
          return (
            <dl className="mt-3 grid gap-2 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-3">
              <div>
                <dt className="font-medium text-foreground">When it is sent</dt>
                <dd className="mt-0.5 text-muted-foreground">{g.when}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Subject</dt>
                <dd className="mt-0.5 text-muted-foreground">{g.subject}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Scope and documents</dt>
                <dd className="mt-0.5 text-muted-foreground">{g.attachments}</dd>
              </div>
            </dl>
          );
        })()}
      </div>

      {/*
        * An unpublished draft, stated where it cannot be missed.
        *
        * Saving used to put the new wording straight into the next outreach
        * run. It writes a draft now, which is safer and introduces exactly one
        * new way to be wrong: an operator who edits, saves, and leaves,
        * believing the change is live while the platform keeps sending the old
        * text. This block exists to make that impossible to walk away from.
        */}
      {pending && (
        <div
          role="status"
          className="rounded-md border border-review/40 bg-review/5 px-3 py-3"
        >
          <p className="text-sm font-medium text-review">
            Draft saved. It is not being sent yet.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Saved {formatDate(pending.draftedAt)}
            {pending.draftedBy ? ` by ${pending.draftedBy}` : ""}.{" "}
            {owned
              ? `Subcontractors keep receiving version ${publishedVersion} until you publish.`
              : "Subcontractors keep receiving the wording this platform ships with until you publish."}
          </p>
          {!draftDiffers && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              This draft is word for word the same as the version in use, so
              publishing it changes nothing anybody receives.
            </p>
          )}
          {dirty && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              You have further changes that are not saved. Save them first:
              publishing puts the saved draft into use, not what is on screen.
            </p>
          )}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={publish}
              disabled={publishBusy || dirty || problems.length > 0}
              title={
                dirty
                  ? "Save your changes first. Publishing uses the saved draft."
                  : problems.length > 0
                    ? "Fix the fill-in field problems listed below first."
                    : undefined
              }
            >
              {publishBusy ? "Publishing…" : "Publish this draft"}
            </button>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => setDiscardOpen(true)}
              disabled={discardBusy}
            >
              Discard draft
            </button>
            {draftDiffers && (
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => setShowLive((v) => !v)}
                aria-expanded={showLive}
              >
                {showLive
                  ? "Hide what publishing changes"
                  : "See what publishing changes"}
              </button>
            )}
          </div>
          {showLive && draftDiffers && (
            <div className="mt-3 space-y-3">
              {(pending.subject ?? "") !== liveSubject && (
                <div>
                  <p className="label mb-1 text-xs">Subject line</p>
                  <p className="rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs text-muted-foreground line-through dark:border-white/10">
                    {liveSubject || "(no subject)"}
                  </p>
                  <p className="mt-1 rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs text-foreground dark:border-white/10">
                    {pending.subject || "(no subject)"}
                  </p>
                </div>
              )}
              {pending.body !== liveBody && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="label mb-1 text-xs">Being sent now</p>
                    <p className="scroll-thin max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground dark:border-white/10">
                      {liveBody}
                    </p>
                  </div>
                  <div>
                    <p className="label mb-1 text-xs">This draft</p>
                    <p className="scroll-thin max-h-48 overflow-y-auto whitespace-pre-wrap rounded border border-border/55 bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground dark:border-white/10">
                      {pending.body}
                    </p>
                  </div>
                </div>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">
                Publishing takes effect on the next outreach this platform
                sends. Emails already sent are unaffected, and the wording in
                use now stays in the version history below.
              </p>
            </div>
          )}
        </div>
      )}

      {publishNotice && (
        <p className="text-xs font-medium text-pursue">{publishNotice}</p>
      )}

      {problems.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-risk/40 bg-risk/10 px-3 py-2 text-xs text-risk"
        >
          <p className="font-medium">
            This template cannot be saved or sent as written.
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {problems.map((p, i) => (
              <li key={i}>{p.message}</li>
            ))}
          </ul>
        </div>
      )}

      {/*
        * What this wording has done in practice.
        *
        * The page could tell an operator whether a template was correct and
        * never whether it worked, so a subject line that had been quietly
        * bouncing for months looked identical to one that got answered every
        * time. Every rate can be absent, and absent says why.
        */}
      <TemplateMetricsStrip metrics={metrics} />

      {/*
        * Warnings, not refusals. A subject in block capitals is legal and
        * ill-advised, and the person writing it decides. Shown at a different
        * weight from the block above for exactly that reason.
        */}
      {delivery.length > 0 && (
        <div className="rounded-md border border-review/40 bg-review/5 px-3 py-2.5 text-xs">
          <p className="font-medium text-review">
            {delivery.length === 1
              ? "One thing that may keep this out of an inbox"
              : `${delivery.length} things that may keep this out of an inbox`}
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {delivery.map((d, i) => (
              <li key={i} className="leading-relaxed text-slate-700">
                <span className={d.severity === "warning" ? "text-review" : "text-slate-600"}>
                  {d.message}
                </span>{" "}
                <span className="text-slate-500">{d.fix}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Token palette */}
      <TokenPalette onInsert={insertToken} />

      {/* Subject */}
      <div className={template.slug === "template_2_followup" ? "hidden" : undefined}>
        {/* Associated as well as visible, so clicking the label focuses the
            field. The aria-label below named it for a screen reader and did
            nothing for a mouse. */}
        {/* Scoped to the slug. Every template on the page used the same two
            element ids, so clicking a label focused the first template's
            field no matter which template the label belonged to. */}
        <label className="label mb-1.5 block" htmlFor={`template-subject-${template.slug}`}>
          Subject line
        </label>
        <input
          id={`template-subject-${template.slug}`}
          ref={subjectRef}
          className="input font-mono text-sm"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onFocus={() => {
            lastFocused.current = "subject";
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropSubject}
          placeholder="e.g. Pricing request: {{trade}} | {{location_city_state}}"
        />
      </div>

      {/* Body */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <label className="label block" htmlFor={`template-body-${template.slug}`}>
            Email body
          </label>
          <div
            className="flex flex-wrap items-center gap-1"
            role="toolbar"
            aria-label="Email body formatting"
          >
            <FormatButton label="Bold" title="Bold selected text" onClick={formatBold} />
            <FormatButton
              label="Highlight"
              title="Highlight selected text"
              onClick={formatHighlight}
            />
            <FormatButton
              label="Bullets"
              title="Turn selected lines into a bullet list"
              onClick={formatBullets}
            />
          </div>
        </div>
        <textarea
          id={`template-body-${template.slug}`}
          ref={bodyRef}
          className="input min-h-[260px] resize-y font-mono text-sm leading-relaxed"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => {
            lastFocused.current = "body";
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDropBody}
          placeholder="Write your email here. Select text, then use Bold, Highlight, or Bullets. Click or drag a fill-in field above to insert it."
        />
        <p className="mt-1.5 text-xs text-muted-foreground">
          Highlight applies to each line, not a whole block. Fill-in fields look
          like <span className="font-mono text-foreground">{"{{trade}}"}</span> and
          are replaced when Brost Co sends the email. You do not need to write the
          scope, the requirements, the questions or the document list: those are
          added automatically underneath what you write here.
        </p>
      </div>

      {problems.length > 0 && (
        <p className="text-xs text-risk">
          {problems.length === 1
            ? problems[0].message
            : `${problems.length} fill-in field problems, listed at the top of this template.`}
        </p>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="btn-primary"
          onClick={save}
          // Blocked rather than allowed-and-rejected: the server refuses this
          // too, and a button that fails is a worse explanation than one that
          // says why it cannot be pressed.
          disabled={busy || problems.length > 0}
          title={
            problems.length > 0
              ? "Fix the fill-in field problems listed above first."
              : undefined
          }
        >
          {busy ? "Saving…" : "Save template"}
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={() => {
            setShowPreview(true);
            void loadPairings();
          }}
        >
          Preview email
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={sendTestEmail}
          disabled={testBusy || problems.length > 0}
          title={
            problems.length > 0
              ? "Fix the fill-in field problems listed above first."
              : undefined
          }
        >
          {testBusy ? "Sending…" : "Send test email"}
        </button>
        {savedVersion !== null && (
          <span className="text-xs font-medium text-pursue">
            ✓ Saved as draft version {savedVersion}. Not being sent yet.
          </span>
        )}
        {testResult?.ok && (
          <span className="text-xs font-medium text-pursue">
            ✓ Test email sent to {testResult.email}
          </span>
        )}
        {testResult?.ok === false && (
          <span className="text-xs text-risk">{testResult.error}</span>
        )}
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>

      <ConfirmDialog
        open={discardOpen}
        title={`Discard the unpublished draft of ${humanSlug(template.slug)}`}
        body={
          <>
            <p>
              The saved draft is deleted and the editor goes back to the
              wording being sent now.
            </p>
            <p className="mt-2">
              No email changes. A draft is never sent, so nothing anybody
              receives is different before or after this.
            </p>
          </>
        }
        confirmLabel="Discard the draft"
        danger
        busy={discardBusy}
        onConfirm={() => void discard()}
        onCancel={() => setDiscardOpen(false)}
      />

      {/* Version history */}
      <VersionHistory
        slug={template.slug}
        publishedVersion={publishedVersion}
        refreshKey={historyKey}
        onRestored={handleRestored}
      />

      {/* Preview overlay */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPreview(false);
          }}
        >
          <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border/55 bg-surface text-foreground shadow-2xl dark:border-white/10">
            {/* Preview header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/55 px-6 py-4 dark:border-white/10">
              <div className="min-w-0 flex-1">
                <p className="eyebrow text-accent-strong">
                  {realCtx ? "Email preview \u00b7 real record" : "Email preview \u00b7 sample values"}
                </p>
                <p className="mt-2 text-sm font-medium text-foreground break-words">
                  Subject: {previewSubject}
                </p>

                <label className="label mt-3 block" htmlFor={`preview-pair-${template.slug}`}>
                  Preview against
                </label>
                <select
                  id={`preview-pair-${template.slug}`}
                  className="input h-9 w-full max-w-md text-xs"
                  value={pairKey}
                  onChange={(e) => void loadRealContext(e.target.value)}
                >
                  <option value="">Sample values</option>
                  {pairings.map((p) => (
                    <option
                      key={`${p.opportunity_id}|${p.subcontractor_id}|${p.trade ?? ""}`}
                      value={`${p.opportunity_id}|${p.subcontractor_id}|${p.trade ?? ""}`}
                    >
                      {p.company_name}
                      {p.trade ? ` (${p.trade})` : ""} {"\u2014"}{" "}
                      {p.opportunity_title ?? "untitled opportunity"}
                    </option>
                  ))}
                </select>
                {ctxBusy && (
                  <p className="mt-1 text-xs text-muted-foreground">Loading that record...</p>
                )}
                {pairsAreHypothetical && pairings.length > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No subcontractor has been approached on a live job yet, so these
                    pair each open opportunity with a firm whose trades match. The
                    values are real, and so are the gaps.
                  </p>
                )}
                {ctxError && <p className="mt-1 text-xs text-risk">{ctxError}</p>}
                {!ctxBusy && !ctxError && pairings.length === 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    No open opportunities with contactable subcontractors yet, so
                    only sample values are available.
                  </p>
                )}
              </div>
              <button
                className="btn-ghost shrink-0 text-xs"
                onClick={() => setShowPreview(false)}
              >
                Close
              </button>
            </div>
            {/* Preview body */}
            <div className="scroll-thin overflow-y-auto px-6 py-5">
              <div
                className="email-preview prose-sm text-sm leading-relaxed text-foreground"
                dangerouslySetInnerHTML={{ __html: previewBodyHtml }}
              />
            </div>
            {/* Preview footer */}
            <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
              {realCtx ? (
                <>
                  {realCtx.missingRequired.length > 0 ? (
                    <p className="text-xs text-risk">
                      <span className="font-medium">
                        This email could not be sent for this record.
                      </span>{" "}
                      Missing:{" "}
                      {realCtx.missingRequired
                        .map((k) => TEMPLATE_TOKENS.find((t) => t.key === k)?.label ?? k)
                        .join(", ")}
                      .
                    </p>
                  ) : (
                    <p className="text-xs text-pursue">
                      This record has everything the email needs. It would send as
                      shown, with {realCtx.attachedNames.length} document
                      {realCtx.attachedNames.length === 1 ? "" : "s"} attached.
                    </p>
                  )}
                  {realCtx.warnings.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                      {realCtx.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Sample values, which are complete by construction, so this preview
                  always looks right. Pick a real opportunity above to see whether an
                  email could actually be sent for it.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FormatButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => {
        // Keep textarea selection when clicking the toolbar.
        e.preventDefault();
      }}
      onClick={onClick}
      /* min-h-11 / min-w-11 on touch: a 45x26 formatting button is the kind
         of target you miss twice before hitting, in the middle of writing. */
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-surface lg:min-h-0 lg:min-w-0"
    >
      {label}
    </button>
  );
}

/**
 * Usage and delivery for one template.
 *
 * The audit asks the template list to carry usage, open rate, reply rate and
 * bounce rate. Those four numbers are only worth showing if they refuse to
 * lie, so each one is absent rather than nought when there is nothing behind
 * it, a thin history says it is thin, and the open rate carries the caveat
 * that it is counted by an image some clients fetch and others block.
 */
function TemplateMetricsStrip({ metrics }: { metrics: TemplateMetrics }) {
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2.5">
      <p className="text-xs leading-relaxed text-slate-700">{metricsSummary(metrics)}</p>
      {metrics.sent > 0 && (
        <>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
            <Metric label="Times sent" value={String(metrics.sent)} />
            <Metric label="Opened" value={openRateLabel(metrics)} note={OPEN_RATE_CAVEAT} />
            <Metric label="Replied" value={formatMetric(metrics.replyRate, metrics.sent)} />
            <Metric
              label="Bounced"
              value={formatMetric(metrics.bounceRate, metrics.sent)}
              tone={metrics.bounceRate != null && metrics.bounceRate >= 5 ? "risk" : undefined}
            />
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-500">{OPEN_RATE_CAVEAT}</p>
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: "risk";
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.65rem] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd
        className={`num truncate text-sm ${tone === "risk" ? "text-risk" : "text-foreground"}`}
        title={note}
      >
        {value}
      </dd>
    </div>
  );
}
