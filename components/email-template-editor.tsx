"use client";

import { useRef, useState } from "react";
import { TokenPalette } from "@/components/token-palette";

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

// ---------------------------------------------------------------------------
// Preview sample values (one realistic example per token)
// ---------------------------------------------------------------------------

const SAMPLE: Record<string, string> = {
  owner_name: "Marcus",
  company_name: "BROSTCO Holdings LLC",
  opportunity_title: "HVAC Maintenance Services, Building 36C",
  location_state: "Virginia",
  deadline: "Aug 25, 2026",
  trade: "HVAC",
  scope_summary:
    "replace HVAC units in 4 buildings, approximately 120,000 sq ft total",
  questions:
    "- Do you have experience with federal facilities in Virginia?\n- Can you provide bonding and insurance certificates within 48 hours?",
  sender_name: "Jared",
  phone: "(800) 555-0199",
  solicitation_number: "W912DR-26-R-0042",
  agency: "US Army Corps of Engineers",
};

function renderPreview(template: string): string {
  return template.replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_, key) => SAMPLE[key] ?? `{{${key}}}`
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function humanSlug(slug: string): string {
  if (slug === "template_1_outreach") return "Initial outreach email";
  if (slug === "template_2_followup") return "48-hour follow-up email";
  return slug.replace(/_/g, " ");
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
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 shrink-0">
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
                        <p className="rounded bg-white border border-border px-3 py-2 font-mono text-xs text-slate-700 whitespace-pre-wrap">
                          {v.subject || <em className="text-slate-400">(no subject)</em>}
                        </p>
                      </div>
                      <div>
                        <p className="label mb-1 text-xs">Body</p>
                        <p className="max-h-48 overflow-y-auto rounded bg-white border border-border px-3 py-2 font-mono text-xs text-slate-700 whitespace-pre-wrap leading-relaxed scroll-thin">
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
  const [currentVersion, setCurrentVersion] = useState(template.version);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
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
    // The editor fields are NOT overwritten — the operator must explicitly
    // decide whether to adopt the restored content.
    setCurrentVersion(newVersion);
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const previewSubject = renderPreview(subject || "(no subject)");
  const previewBody = renderPreview(body);

  return (
    <div className="card space-y-5">
      {/* Header */}
      <div className="border-b border-border pb-4">
        <p className="font-medium text-slate-900">{humanSlug(template.slug)}</p>
        {template.description && (
          <p className="mt-0.5 text-sm text-slate-500">{template.description}</p>
        )}
        <p className="mt-1 text-xs text-slate-400">
          Currently on version {currentVersion}
        </p>
      </div>

      {/* Token palette */}
      <TokenPalette onInsert={insertToken} />

      {/* Subject */}
      <div>
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
          placeholder="e.g. {{trade}} Quote Request, {{location_state}}"
        />
      </div>

      {/* Body */}
      <div>
        <label className="label mb-1.5 block">Email body</label>
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
          placeholder="Write your email here. Click or drag a token above to insert it at the cursor."
        />
        <p className="mt-1.5 text-xs text-slate-400">
          Plain text. Line breaks become line breaks in the email. Click a token
          chip to insert it at the cursor, or drag it into this field.
        </p>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save template"}
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={() => setShowPreview(true)}
        >
          Preview email
        </button>
        <button
          className="btn-ghost"
          type="button"
          onClick={sendTestEmail}
          disabled={testBusy}
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
          <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-white shadow-2xl">
            {/* Preview header */}
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
              <div className="min-w-0">
                <p className="eyebrow text-accent-strong">
                  Email preview · sample values
                </p>
                <p className="mt-2 text-sm font-medium text-slate-900 break-words">
                  Subject: {previewSubject}
                </p>
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
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                {previewBody}
              </p>
            </div>
            {/* Preview footer */}
            <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
              <p className="text-xs text-slate-400">
                Tokens shown with representative sample data. Actual emails use
                live solicitation values.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
