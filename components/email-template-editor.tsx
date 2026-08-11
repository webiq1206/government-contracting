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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);

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
      setSavedVersion(data.version ?? null);
      setTimeout(() => setSavedVersion(null), 5000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
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
          Currently on version {template.version}
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
        {savedVersion !== null && (
          <span className="text-xs font-medium text-emerald-700">
            ✓ Saved as version {savedVersion}
          </span>
        )}
        {error && <span className="text-xs text-risk">{error}</span>}
      </div>

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
