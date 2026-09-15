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
import { readDeliveryCode, statusFromDetail } from "@/lib/domain/email-delivery";
import type { MessageState } from "@/lib/domain/message-state";
import { EmailMessage, EmailTimeline } from "@/components/email-message";
import { UnsavedGuard } from "@/components/unsaved-guard";

function stateTone(state: MessageState): string {
  if (state === "bounced" || state === "blocked" || state === "failed") {
    return "bg-risk/15 text-risk";
  }
  if (state === "delayed" || state === "draft") return "bg-review/15 text-review";
  if (state === "replied" || state === "clicked" || state === "opened") {
    return "bg-pursue/15 text-pursue";
  }
  return "bg-slate-200 text-slate-600";
}

export function ConversationThreadPane({
  conversation,
  messages,
  canSend,
  canSeeRaw,
  backHref,
  stateLabels,
  stateMeanings,
  initialText = "",
}: {
  conversation: ConversationSummary;
  messages: CentreMessage[];
  canSend: boolean;
  /**
   * Whether this viewer may see the raw text a remote mail server returned.
   *
   * Not a secret, but it is a postmaster's diagnostic rather than something
   * anybody reading a thread needs, and it names internal message ids and
   * host names. The plain-English reading above it is what the work actually
   * turns on, and everybody gets that.
   */
  canSeeRaw: boolean;
  backHref: string;
  stateLabels: Record<MessageState, string>;
  stateMeanings: Record<MessageState, string>;
  /**
   * A reply already written, from a row that opened this thread in order to
   * ask for something. Only a starting point: it lands in the box and the
   * operator edits and sends it themselves, because nothing here mails a
   * subcontractor without a person reading it first.
   */
  initialText?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<null | "send" | "resolve" | "address">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [address, setAddress] = useState(conversation.subcontractorEmail ?? "");
  const [correcting, setCorrecting] = useState(false);

  async function post(url: string, body: unknown, kind: "send" | "resolve" | "address") {
    setBusy(kind);
    setError(null);
    setNotice(null);
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
      setError(kind === "send" ? "Could not confirm whether this reply was sent. Your draft is still here. Check the conversation before trying again." : "Could not confirm the change. Refresh to check its status before trying again.");
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
      setNotice("Reply sent. It will appear in this conversation.");
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
  /*
   * A prefilled reply follows the thread it was asked for. Without this the
   * pane keeps whatever was in the box when the reader moves on, so opening
   * "ask them for what is missing" on a second conversation showed the first
   * one's draft, addressed to the wrong firm.
   *
   * Only when the box is empty or still holds the previous prefill: a half
   * written reply is the reader's, not ours to replace.
   */
  const [lastPrefill, setLastPrefill] = useState(initialText);
  useEffect(() => {
    if (initialText === lastPrefill) return;
    setLastPrefill(initialText);
    setText((current) => (current.trim() === "" || current === lastPrefill ? initialText : current));
  }, [initialText, lastPrefill]);

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
      <UnsavedGuard when={Boolean(text.trim())} message="Your reply has not been sent. Keep a copy before leaving. Leave without saving?" />
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
        <EmailTimeline messages={messages.map((m, index) => {
          const mine = m.direction === "outbound";
          return (
            <EmailMessage
              key={m.id}
              body={m.body} direction={mine ? "outbound" : "inbound"}
              contact={conversation.subcontractorName} recipient={m.recipient_email}
              date={m.created_at} latest={index === messages.length - 1}
              label={!mine ? "Received email" : m.state === "draft" ? "Unsent draft" : "Outgoing email"}
            >
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${stateTone(m.state)}`}
                  title={stateMeanings[m.state]}
                >
                  {stateLabels[m.state]}
                </span>
                {m.delivery_detail && (
                  <DeliveryDetail detail={m.delivery_detail} canSeeRaw={canSeeRaw} />
                )}
              </div>
            </EmailMessage>
          );
        })} />
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
              <label className="mb-2 block text-sm font-semibold" htmlFor="reply-body">
                Unsent reply to {conversation.subcontractorName}
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
        {notice && <p role="status" className="mt-2 text-sm text-pursue">{notice}</p>}
      </div>
    </div>
  );
}


/**
 * What a delivery failure means, with the server's own words underneath.
 *
 * The raw diagnostic is written for a postmaster: "550 5.1.1 The email
 * account that you tried to reach does not exist" and "550 5.7.1 Message
 * rejected due to content" both read as rejection to an estimator, and they
 * need opposite responses. One means find a different address; the other
 * means the address was fine all along and hunting for a new contact is
 * wasted work.
 *
 * So the reading is always shown and never collapsed, and the raw text sits
 * behind an expander for the people whose job it is.
 */
function DeliveryDetail({ detail, canSeeRaw }: { detail: string; canSeeRaw: boolean }) {
  const reading = readDeliveryCode(statusFromDetail(detail));
  return (
    <span className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
      {reading ? (
        <span className={reading.addressAtFault ? "text-risk" : undefined}>
          {reading.meaning}
          {reading.fix ? ` ${reading.fix}` : ""}
        </span>
      ) : (
        // No code to read, so the server's own sentence is the best there is.
        // Shown rather than hidden: something is better than a bare state.
        <span className="break-all">{detail.slice(0, 200)}</span>
      )}
      {canSeeRaw && reading && (
        <details className="text-[11px] text-slate-500">
          <summary className="tap cursor-pointer">What the server said</summary>
          <p className="mt-1 break-all font-mono">{detail}</p>
        </details>
      )}
    </span>
  );
}
