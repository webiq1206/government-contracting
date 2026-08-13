"use client";

/**
 * Email conversations with a subcontractor, readable and replyable in place.
 *
 * Built to read like a mail client rather than a log: newest conversation
 * first, oldest message first inside it, our messages and theirs visually
 * distinct, and a reply box attached to the conversation it belongs to. The
 * point is that nobody has to open Gmail to answer a subcontractor.
 *
 * The reply box can also be filled in for you. "Draft a reply" asks for a
 * suggested answer to their last message and drops it here to be edited and
 * sent like anything else typed by hand. It runs only when pressed, because
 * most replies never need one, and what it writes is kept, because generating
 * it costs money and walking away from the page should not spend it twice.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { replyTarget } from "@/lib/domain/conversation-thread";
import { createDraftAutosave } from "@/lib/client/draft-autosave";
import type {
  Conversation,
  ConversationMessage,
} from "@/lib/domain/conversation-thread";

export type { Conversation, ConversationMessage };

/** A kept draft, as the server stores it. */
export interface StoredReplyDraft {
  communicationId: string;
  body: string;
  warnings: string[];
  edited: boolean;
  generatedAt: string;
  /** Revision of the stored text; edits count up from here. */
  rev: number;
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

/** The message a draft would answer, or null when the last word is ours. */
function replyTargetId(c: Conversation): string | null {
  return replyTarget(c)?.id ?? null;
}

export function ConversationThreads({
  subcontractorId,
  canSend,
  conversations,
  savedDrafts = {},
}: {
  subcontractorId: string;
  /** False when no inbox is connected, so the composer explains instead of failing. */
  canSend: boolean;
  conversations: Conversation[];
  /** Drafts already generated for these threads, keyed by inbound message id. */
  savedDrafts?: Record<string, StoredReplyDraft>;
}) {
  const router = useRouter();
  const [openKey, setOpenKey] = useState<string | null>(
    // Open whichever conversation is waiting on us; that is the one they came for.
    conversations.find((c) => c.awaitingUs)?.key ?? conversations[0]?.key ?? null
  );
  // Seeded from what was kept, so an operator returning to a thread finds the
  // draft they left rather than an empty box and a second bill to refill it.
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const seeded: Record<string, string> = {};
    for (const c of conversations) {
      const id = replyTargetId(c);
      const saved = id ? savedDrafts[id] : null;
      if (saved) seeded[c.key] = saved.body;
    }
    return seeded;
  });
  const [warnings, setWarnings] = useState<Record<string, string[]>>(() => {
    const seeded: Record<string, string[]> = {};
    for (const c of conversations) {
      const id = replyTargetId(c);
      const saved = id ? savedDrafts[id] : null;
      if (saved?.warnings?.length) seeded[c.key] = saved.warnings;
    }
    return seeded;
  });
  // Keyed by inbound message id and nothing else. Keying this by conversation
  // as well looked harmless and quietly broke autosave on every draft loaded
  // from the server: the writer checked one key while the seed had set the
  // other, so edits to a restored draft were never saved.
  const [hasDraft, setHasDraft] = useState<Record<string, boolean>>(() => {
    const seeded: Record<string, boolean> = {};
    for (const c of conversations) {
      const id = replyTargetId(c);
      if (id && savedDrafts[id]) seeded[id] = true;
    }
    return seeded;
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, { ok: boolean; text: string }>>({});

  // Persistence of operator edits. The ordering, debounce and drop rules live
  // in the autosave module so they can be tested on their own; all that is
  // left here is the transport and the page lifecycle.
  const autosave = useRef(
    createDraftAutosave({
      send: async ({ communicationId, body, rev, keepalive }) => {
        await fetch("/api/conversations/draft", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ communicationId, body, rev }),
          keepalive,
        });
      },
    })
  ).current;

  // Edits count up from whatever the server already holds. Starting from zero
  // after a reload would make every edit look older than the stored text, and
  // autosave would go quiet without anything appearing to be wrong.
  const seeded = useRef(false);
  if (!seeded.current) {
    seeded.current = true;
    for (const [id, d] of Object.entries(savedDrafts)) autosave.seed(id, d.rev ?? 0);
  }

  useEffect(() => {
    // A tab closing, or a phone switching apps, never runs React cleanup, so
    // the last edit has to be pushed out from here too.
    const onHide = () => autosave.flush(true);
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      // Navigating away inside the app: still alive, so this can go through
      // the ordered queue rather than racing whatever is in flight.
      autosave.flush(false);
    };
  }, [autosave]);

  function invalidateSaves(communicationId: string | null) {
    if (communicationId) autosave.invalidate(communicationId);
  }

  function queueSave(communicationId: string | null, body: string) {
    if (!communicationId || !hasDraft[communicationId]) return;
    autosave.edit(communicationId, body);
  }

  async function draft(c: Conversation) {
    const communicationId = replyTargetId(c);
    if (!communicationId) return;
    setDrafting(c.key);
    setResult((r) => ({ ...r, [c.key]: { ok: true, text: "Writing a draft…" } }));
    try {
      const res = await fetch("/api/conversations/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ communicationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setResult((r) => ({
          ...r,
          [c.key]: { ok: false, text: data.error ?? "Could not write a draft." },
        }));
        return;
      }
      const d = data.draft as StoredReplyDraft;
      // A rewrite replaces what was there, including any edit, so nothing
      // scheduled against the old text may still land on top of it. Anything
      // already on the wire is handled by the revision instead: the rewrite
      // bumped the stored one, so that write is now older and will be refused.
      invalidateSaves(communicationId);
      autosave.seed(communicationId, d.rev ?? 0);
      setDrafts((prev) => ({ ...prev, [c.key]: d.body }));
      setWarnings((w) => ({ ...w, [c.key]: d.warnings ?? [] }));
      setHasDraft((h) => ({ ...h, [communicationId]: true }));
      setResult((r) => ({
        ...r,
        [c.key]: { ok: true, text: "Draft ready. Read it before you send it." },
      }));
    } catch (e) {
      setResult((r) => ({ ...r, [c.key]: { ok: false, text: (e as Error).message } }));
    } finally {
      setDrafting(null);
    }
  }

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
      // The send path discards the stored draft server-side, in the same
      // request. All that is left here is to stop a queued autosave from
      // writing the sent text back over it.
      const sentFor = replyTargetId(c);
      if (sentFor) {
        invalidateSaves(sentFor);
        setHasDraft((h) => ({ ...h, [sentFor]: false }));
      }
      setDrafts((d) => ({ ...d, [c.key]: "" }));
      setWarnings((w) => ({ ...w, [c.key]: [] }));
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
        const inboundId = replyTargetId(c);
        const flags = warnings[c.key] ?? [];
        const written = inboundId != null && hasDraft[inboundId] === true;
        return (
          <div key={c.key} id={`thread-${c.key}`} className="rounded-md border border-border">
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
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="label" htmlFor={`reply-${c.key}`}>
                          Reply
                        </label>
                        {inboundId && (
                          <button
                            type="button"
                            className="btn-secondary ml-auto text-xs"
                            onClick={() => draft(c)}
                            disabled={drafting != null || busy != null}
                          >
                            {drafting === c.key
                              ? "Writing…"
                              : written
                                ? "Rewrite draft"
                                : "Draft a reply"}
                          </button>
                        )}
                      </div>
                      <textarea
                        id={`reply-${c.key}`}
                        className="input mt-1 min-h-24"
                        placeholder="Type your reply. It goes out from your own email address, in this same conversation."
                        value={drafts[c.key] ?? ""}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDrafts((d) => ({ ...d, [c.key]: value }));
                          queueSave(inboundId, value);
                        }}
                      />
                      {written && (
                        <p className="mt-1 text-xs text-slate-500">
                          Suggested by Brost Co from what they wrote and what we have on
                          file. Check it, change anything you want, then send.
                        </p>
                      )}
                      {flags.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-xs text-review">
                          {flags.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      )}
                      {res && (
                        <p className={`mt-1 text-sm ${res.ok ? "text-pursue" : "text-risk"}`}>
                          {res.text}
                        </p>
                      )}
                      <button
                        type="button"
                        className="btn-primary mt-2 text-xs"
                        onClick={() => send(c)}
                        disabled={busy != null || drafting != null}
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
