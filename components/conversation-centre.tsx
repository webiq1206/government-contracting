"use client";

/**
 * One conversation, read and answered in place.
 *
 * The list beside this answers "who is waiting on me". This answers "what did
 * they actually say", and it has to end with the reply box, because a page
 * that shows you a question and then sends you to Gmail to answer it has moved
 * the work rather than done it.
 *
 * The action row is the second half. Every state this conversation can be in
 * has exactly one obvious next move -- a bounced address needs correcting, a
 * blocked one needs a phone call, a finished one needs closing -- and each of
 * those is here rather than three screens away.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  ConversationSummary,
  CentreMessage,
} from "@/lib/domain/conversation-centre";
import type { MessageState } from "@/lib/domain/message-state";

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

function stateTone(state: MessageState): string {
  if (state === "bounced" || state === "blocked" || state === "failed") {
    return "bg-risk/15 text-risk";
  }
  if (state === "delayed") return "bg-review/15 text-review";
  if (state === "replied" || state === "clicked" || state === "opened") {
    return "bg-pursue/15 text-pursue";
  }
  return "bg-slate-200 text-slate-600";
}

/** Plain text out of a stored HTML body, so a thread reads like a thread. */
function readable(body: string | null): string {
  if (!body) return "";
  return body
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ConversationThreadPane({
  conversation,
  messages,
  canSend,
  backHref,
  stateLabels,
  stateMeanings,
}: {
  conversation: ConversationSummary;
  messages: CentreMessage[];
  canSend: boolean;
  backHref: string;
  stateLabels: Record<MessageState, string>;
  stateMeanings: Record<MessageState, string>;
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<null | "send" | "resolve" | "address">(null);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState(conversation.subcontractorEmail ?? "");
  const [correcting, setCorrecting] = useState(false);

  async function post(url: string, body: unknown, kind: "send" | "resolve" | "address") {
    setBusy(kind);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not work. Nothing was sent.");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server. Nothing was sent.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function send() {
    if (!text.trim()) {
      setError("Write a message first.");
      return;
    }
    const ok = await post(
      "/api/conversations/reply",
      {
        subcontractorId: conversation.subcontractorId,
        opportunityId: conversation.opportunityId,
        threadId: conversation.threadKey.startsWith("pair:") ? null : conversation.threadKey,
        inReplyTo: conversation.replyToMessageId,
        subject: conversation.subject,
        message: text,
      },
      "send"
    );
    if (ok) {
      setText("");
      router.refresh();
    }
  }

  async function setResolved(resolved: boolean) {
    const ok = await post(
      "/api/conversations/flags",
      { threadKey: conversation.threadKey, resolved },
      "resolve"
    );
    if (ok) router.refresh();
  }

  async function saveAddress() {
    const ok = await post(
      "/api/conversations/address",
      { subcontractorId: conversation.subcontractorId, email: address.trim() },
      "address"
    );
    if (ok) {
      setCorrecting(false);
      router.refresh();
    }
  }

  /*
   * Recorded when the pane is actually mounted in front of somebody, which is
   * the only moment that means "read". Fire and forget: if it fails the
   * conversation stays unread, which is the safe direction to be wrong in.
   */
  useEffect(() => {
    const key = conversation.threadKey;
    if (conversation.unreadCount === 0) return;
    let cancelled = false;
    fetch("/api/conversations/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ threadKey: key }),
    })
      .then((r) => {
        if (r.ok && !cancelled) router.refresh();
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversation.threadKey, conversation.unreadCount, router]);

  const resolved = conversation.state === "resolved";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 border-b border-border/55 px-4 py-3 dark:border-white/10 sm:px-6">
        <Link href={backHref} className="tap text-xs text-slate-500 hover:text-accent lg:hidden">
          Back to conversations
        </Link>
        <h2 className="mt-1 truncate text-base font-medium text-foreground lg:mt-0">
          {conversation.subject}
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {conversation.subcontractorName}
          {conversation.subcontractorEmail ? ` · ${conversation.subcontractorEmail}` : ""}
          {` · ${conversation.messageCount} message${conversation.messageCount === 1 ? "" : "s"}`}
        </p>

        {/*
          * What is true right now and what to do about it, above the messages
          * rather than buried under them. The next action is one sentence,
          * because a list of five equally-weighted options is the same as no
          * guidance at all.
          */}
        <div className="mt-2 rounded-md border border-border/60 bg-surface px-3 py-2">
          <p className="text-sm text-foreground">{conversation.reason}</p>
          <p className="mt-0.5 text-sm text-slate-600">
            <span className="font-medium text-foreground">Next: </span>
            {conversation.nextAction}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap gap-2">
          {conversation.failedState === "bounced" && conversation.subcontractorId && (
            <button
              type="button"
              onClick={() => setCorrecting((v) => !v)}
              className="btn-ghost text-xs"
            >
              {correcting ? "Cancel" : "Correct email"}
            </button>
          )}
          {conversation.opportunityId && (
            <Link
              href={`/call-queue?opportunity=${conversation.opportunityId}`}
              className="btn-ghost text-xs"
            >
              Call instead
            </Link>
          )}
          <button
            type="button"
            onClick={() => setResolved(!resolved)}
            disabled={busy === "resolve"}
            className="btn-ghost text-xs"
          >
            {busy === "resolve"
              ? "Saving…"
              : resolved
                ? "Reopen this conversation"
                : "Mark resolved"}
          </button>
        </div>

        {correcting && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="corrected-email">
              Corrected email address
            </label>
            <input
              id="corrected-email"
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="input max-w-xs text-sm"
              placeholder="name@company.com"
            />
            <button
              type="button"
              onClick={saveAddress}
              disabled={busy === "address"}
              className="btn-primary text-xs"
            >
              {busy === "address" ? "Saving…" : "Save address"}
            </button>
            <p className="w-full text-xs text-slate-500">
              This updates the subcontractor record. Send again afterwards; correcting
              the address does not resend on its own.
            </p>
          </div>
        )}
      </header>

      <div className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-6">
        {messages.map((m) => {
          const mine = m.direction === "outbound";
          const text = readable(m.body);
          return (
            <article
              key={m.id}
              className={`max-w-2xl rounded-lg border px-3 py-2 ${
                mine
                  ? "ml-auto border-gold/40 bg-gold/[0.06]"
                  : "border-border/60 bg-surface"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {mine ? "You" : conversation.subcontractorName}
                </span>
                <span className="text-[11px] text-slate-500">{when(m.created_at)}</span>
              </div>
              {text ? (
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{text}</p>
              ) : (
                <p className="mt-1 text-sm italic text-slate-500">
                  No body was stored for this message.
                </p>
              )}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateTone(m.state)}`}
                  title={stateMeanings[m.state]}
                >
                  {stateLabels[m.state]}
                </span>
                {m.delivery_detail && (
                  <details className="text-[11px] text-slate-500">
                    <summary className="tap cursor-pointer">Technical details</summary>
                    <p className="mt-1 break-all font-mono">{m.delivery_detail}</p>
                  </details>
                )}
              </div>
            </article>
          );
        })}
        {messages.length === 0 && (
          <p className="text-sm text-slate-500">
            This conversation has no messages stored. That is a bug rather than an
            empty inbox; nothing should be listed here without at least one.
          </p>
        )}
      </div>

      <div className="shrink-0 border-t border-border/55 px-4 py-3 dark:border-white/10 sm:px-6">
        {canSend ? (
          conversation.subcontractorId ? (
            <>
              <label className="sr-only" htmlFor="reply-body">
                Your reply
              </label>
              <textarea
                id="reply-body"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                placeholder="Write a reply…"
                className="input w-full resize-y text-sm"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={busy === "send" || !text.trim()}
                  className="btn-primary text-sm"
                >
                  {busy === "send" ? "Sending…" : "Send reply"}
                </button>
                <span className="text-xs text-slate-500">
                  Goes out from your connected mailbox, inside this thread.
                </span>
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">
              This conversation is not linked to a subcontractor record, so there is
              nobody to reply to from here.
            </p>
          )
        ) : (
          <p className="text-xs text-slate-500">
            You can read conversations but not send from them. An owner, admin or
            operator can reply.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-xs text-risk">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
