"use client";

import { useMemo, useRef, useState } from "react";
import { TokenPalette } from "@/components/token-palette";
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
}

interface TemplateVersion {
  id: string;
  version: number;
  subject: string | null;
  body: string;
  is_active: boolean;
  created_at: string;
}

function previewFilled(template: string): string {
  return renderTemplate(template, TEMPLATE_TOKEN_SAMPLES);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanSlug(slug: string): string {
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
function slugGuidance(slug: string): { when: string; subject: string; attachments: string } | null {
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
      when: "Sent 48 hours later, as a reply inside the original conversation, when nobody has answered.",
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
  currentVersion: number;
  onRestored: (newVersion: number, subject: string | null, body: string) => void;
}

function VersionHistory({ slug, currentVersion, onRestored }: VersionHistoryProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [versions, setVersions] = useState<TemplateVersion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);

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
        const newVer = data.version ?? currentVersion + 1;
        setRestoreMsg(`Restored as version ${newVer}.`);
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
        className="flex w-full items-center justify-between text-left"
        onClick={toggle}
        aria-expanded={open}
      >
        <span className="text-sm font-medium text-slate-700">
          Version history
        </span>
        <span className="text-slate-400 text-xs select-none">
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
                  : "text-emerald-700"
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
                        current
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
                      {v.subject
                        ? v.subject
                        : <em className="text-slate-400">(no subject)</em>}
                    </span>
                    <span className="shrink-0 text-[10px] text-slate-400">
                      {formatDate(v.created_at)}
                    </span>
                    <span className="shrink-0 text-slate-400 text-xs select-none">
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
                      {!isCurrent && (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => restore(v)}
                          disabled={isRestoring}
                        >
                          {isRestoring ? "Restoring…" : "Restore this version"}
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
}

/**
 * Edit one outreach template. Shows the subject + body with a draggable /
 * clickable token palette and a preview modal with sample values filled in.
 */
export function EmailTemplateEditor({ template }: Props) {
  const [subject, setSubject] = useState(template.subject ?? "");
  const [body, setBody] = useState(template.body);

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
  const [currentVersion, setCurrentVersion] = useState(template.version);
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
        error?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Save failed");
        return;
      }
      const newVer = data.version ?? currentVersion + 1;
      setCurrentVersion(newVer);
      setSavedVersion(newVer);
      setTimeout(() => setSavedVersion(null), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // -------------------------------------------------------------------------
  // Restore callback (from VersionHistory child)
  // -------------------------------------------------------------------------

  function handleRestored(newVersion: number, restoredSubject: string | null, restoredBody: string) {
    // Update the active version counter shown in the header.
    // The editor fields are NOT overwritten. The operator must explicitly
    // decide whether to adopt the restored content.
    setCurrentVersion(newVersion);
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
      {/* Header */}
      <div className="border-b border-border pb-4">
        <p className="font-medium text-foreground">{humanSlug(template.slug)}</p>
        {template.description && (
          <p className="mt-0.5 text-sm text-slate-500">{template.description}</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Currently on version {currentVersion}
        </p>
        {(() => {
          const g = slugGuidance(template.slug);
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

      {/* Token palette */}
      <TokenPalette onInsert={insertToken} />

      {/* Subject */}
      <div className={template.slug === "template_2_followup" ? "hidden" : undefined}>
        <label className="label mb-1.5 block">Subject line</label>
        <input
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
          <label className="label block">Email body</label>
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
          <span className="text-xs font-medium text-emerald-700">
            ✓ Saved as version {savedVersion}
          </span>
        )}
        {testResult?.ok && (
          <span className="text-xs font-medium text-emerald-700">
            ✓ Test email sent to {testResult.email}
          </span>
        )}
        {testResult?.ok === false && (
          <span className="text-xs text-risk">{testResult.error}</span>
        )}
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>

      {/* Version history */}
      <VersionHistory
        slug={template.slug}
        currentVersion={currentVersion}
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
      className="rounded border border-border bg-background px-2 py-1 text-xs font-medium text-foreground hover:border-foreground/30 hover:bg-surface"
    >
      {label}
    </button>
  );
}
