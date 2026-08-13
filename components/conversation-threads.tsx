"use client";

/**
 * Email conversations with a subcontractor, readable and replyable in place.
 *
 * Built to read like a mail client rather than a log: newest conversation
 * first, oldest message first inside it, our messages and theirs visually
 * distinct, and a reply box attached to the conversation it belongs to. The
 * point is that nobody has to open Gmail to answer a subcontractor.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export interface ConversationMessage {
  id: string;
  direction: "inbound" | "outbound";
  subject: string | null;
  body: string | null;
  created_at: string;
  recipient_email: string | null;
  kind: string | null;
  gmail_message_id: string | null;
}

export interface Conversation {
  key: string;
  threadId: string | null;
  opportunityId: string | null;
  opportunityTitle: string | null;
  trade: string | null;
  subject: string | null;
  lastAt: string;
  replyToMessageId: string | null;
  awaitingUs: boolean;
  messages: ConversationMessage[];
}

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** Label for messages the platform sent on the operator's behalf. */
function kindLabel(kind: string | null): string | null {
  if (kind === "clarification") return "Sent automatically";
  if (kind === "manual") return "Sent by you";
  return null;
}

export function ConversationThreads({
  subcontractorId,
  canSend,
  conversations,
}: {
  subcontractorId: string;
  /** False when no inbox is connected, so the composer explains instead of failing. */
  canSend: boolean;
  conversations: Conversation[];
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(
    // Open whichever conversation is waiting on us; that is the one they came for.
    conversations.find((c) => c.awaitingUs)?.key ?? conversations[0]?.key ?? null
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function send(c: Conversation) {
    const message = (drafts[c.key] ?? "").trim();
    if (!message) {
      setResult((r) => ({ ...r, [c.key]: { ok: false, text: "Write something first." } }));
      return;
    }
    setBusy(c.key);
    setResult((r) => ({ ...r, [c.key]: { ok: true, text: "Sending…" } }));
    try {
      const res = await fetch("/api/conversations/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subcontractorId,
          opportunityId: c.opportunityId,
          threadId: c.threadId,
          inReplyTo: c.replyToMessageId,
          subject: c.subject ? `Re: ${c.subject.replace(/^re:\s*/i, "")}` : undefined,
          message,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult((r) => ({
          ...r,
          [c.key]: { ok: false, text: data.error ?? "Could not send that." },
        }));
        return;
      }
      setDrafts((d) => ({ ...d, [c.key]: "" }));
      setResult((r) => ({ ...r, [c.key]: { ok: true, text: "Sent." } }));
      router.refresh();
    } catch (e) {
      setResult((r) => ({ ...r, [c.key]: { ok: false, text: (e as Error).message } }));
    } finally {
      setBusy(null);
    }
  }

  if (conversations.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border bg-surface/60 px-4 py-5 text-center text-sm text-slate-600">
        No emails with this subcontractor yet. Outreach will start a conversation here, and
        their replies land in the same place.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {conversations.map((c) => {
        const expanded = openKey === c.key;
        const res = result[c.key];
        return (
          <div key={c.key} className="rounded-md border border-border">
            <button
              type="button"
              className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left"
              onClick={() => setOpenKey(expanded ? null : c.key)}
              aria-expanded={expanded}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground">
                  {c.subject ?? "Email conversation"}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  {c.opportunityTitle ?? "No solicitation linked"}
                  {c.trade ? ` · ${c.trade}` : ""} · {c.messages.length} message
                  {c.messages.length === 1 ? "" : "s"} · {when(c.lastAt)}
                </span>
              </span>
              {c.awaitingUs && (
                <span className="badge shrink-0 bg-review/15 text-review">
                  Waiting on you
                </span>
              )}
              <span aria-hidden className="text-xs text-slate-400">
                {expanded ? "▴" : "▾"}
              </span>
            </button>

            {expanded && (
              <div className="border-t border-border px-3 py-3">
                {c.opportunityId && (
                  <Link
                    href={`/opportunity/${c.opportunityId}`}
                    className="mb-2 inline-block text-xs text-accent hover:underline"
                  >
                    Open the solicitation
                  </Link>
                )}

                <div className="space-y-3">
                  {c.messages.map((m) => {
                    const ours = m.direction === "outbound";
                    const label = kindLabel(m.kind);
                    return (
                      <div
                        key={m.id}
                        className={`rounded-md border p-2.5 ${
                          ours
                            ? "border-border bg-muted/40"
                            : "border-accent/30 bg-accent-soft/40"
                        }`}
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-medium text-foreground">
                            {ours ? "You" : "Them"}
                          </span>
                          {label && <span>{label}</span>}
                          <span className="ml-auto">{when(m.created_at)}</span>
                        </div>
                        {m.body && (
                          <p className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">
                            {m.body}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  {canSend ? (
                    <>
                      <label className="label" htmlFor={`reply-${c.key}`}>
                        Reply
                      </label>
                      <textarea
                        id={`reply-${c.key}`}
                        className="input mt-1 min-h-24"
                        placeholder="Type your reply. It goes out from your own email address, in this same conversation."
                        value={drafts[c.key] ?? ""}
                        onChange={(e) =>
                          setDrafts((d) => ({ ...d, [c.key]: e.target.value }))
                        }
                      />
                      {res && (
                        <p className={`mt-1 text-sm ${res.ok ? "text-pursue" : "text-risk"}`}>
                          {res.text}
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn-primary mt-2 text-xs"
                        onClick={() => send(c)}
                        disabled={busy != null}
                      >
                        {busy === c.key ? "Sending…" : "Send reply"}
                      </button>
                    </>
                  ) : (
                    <p className="text-sm text-review">
                      Connect your Google inbox in Settings to reply from here.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
