"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface PendingMessage {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: string;
  subcontractorId: string | null;
  subcontractorName: string | null;
}

export interface MatchTarget {
  id: string;
  title: string;
}

/**
 * Mail that arrived and could not be placed.
 *
 * The poller writes here when it cannot match an inbound message to any
 * outreach it sent. Before this it wrote a line to the automation log, which
 * scrolled away, carried no body, and could only tell somebody to go and look
 * in the mailbox.
 *
 * The message itself is shown, because the whole decision is "what is this
 * about", and that is not answerable from a sender and a subject. Two ways
 * out, and both record something: place it against an opportunity, or say why
 * it is not ours.
 */
export function NeedsMatchingInbox({
  messages,
  opportunities,
  canAct,
}: {
  messages: PendingMessage[];
  /** Open opportunities this reply could belong to. */
  opportunities: MatchTarget[];
  canAct: boolean;
}) {
  const [shown, setShown] = useState(10);
  if (messages.length === 0) {
    return (
      <div className="card">
        <p className="eyebrow mb-2">Needs matching</p>
        <p className="text-sm text-muted-foreground">
          Every message that arrived has been placed against an opportunity.
        </p>
      </div>
    );
  }

  return (
    <details className="card border-review/40 bg-review/5">
      <summary className="min-h-11 cursor-pointer font-medium text-sm">Review unmatched messages ({messages.length})</summary>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="eyebrow">
          Needs matching · <span className="num">{messages.length}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          Replies that arrived but could not be tied to any outreach we sent.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {messages.slice(0, shown).map((m) => (
          <MessageRow key={m.id} message={m} opportunities={opportunities} canAct={canAct} />
        ))}
      </ul>
      {shown < messages.length && <button type="button" className="btn-secondary min-h-11 mt-3" onClick={() => setShown(n => n + 10)}>Show more messages ({messages.length - shown} remaining)</button>}
    </details>
  );
}

function MessageRow({
  message,
  opportunities,
  canAct,
}: {
  message: PendingMessage;
  opportunities: MatchTarget[];
  canAct: boolean;
}) {
  const router = useRouter();
  const pending = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [open, setOpen] = useState<"match" | "dismiss" | null>(null);
  const [opportunityId, setOpportunityId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (payload: Record<string, unknown>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/inbox/needs-matching", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: message.id, ...payload }),
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "That did not work.");
        return;
      }
      setCompleted(true);
      setOpen(null);
      router.refresh();
    } catch {
      setError("The change was not confirmed. Your entries are still here. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  if (completed) return <li role="status" className="py-3 text-sm text-muted-foreground">Message reviewed. Updating your inbox.</li>;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-foreground">
          {message.subcontractorName ?? message.fromName ?? message.fromEmail}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(message.receivedAt).toLocaleString()}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">{message.fromEmail}</p>
      {message.subject && (
        <p className="mt-1 text-sm text-slate-700">{message.subject}</p>
      )}
      {/*
        The body, not just a sender and a subject. "What is this about" is the
        entire decision, and it is not answerable without reading the message.
      */}
      {message.snippet && (
        <details className="mt-1"><summary className="min-h-11 cursor-pointer text-xs text-muted-foreground">Read message</summary><p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words text-sm text-muted-foreground">{message.snippet}</p></details>
      )}

      {canAct && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="min-h-11 text-sm underline underline-offset-2" disabled={busy}
            onClick={() => setOpen(open === "match" ? null : "match")}
          >
            This is about a bid
          </button>
          <button
            type="button"
            className="min-h-11 text-sm underline underline-offset-2" disabled={busy}
            onClick={() => setOpen(open === "dismiss" ? null : "dismiss")}
          >
            Not ours
          </button>
        </div>
      )}

      {open === "match" && opportunities.length === 0 && <p role="status" className="mt-2 text-sm">There are no open opportunities to match. Add the solicitation in Opportunities, then return here.</p>}
      {open === "match" && opportunities.length > 0 && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send({
              action: "match",
              opportunityId,
              subcontractorId: message.subcontractorId ?? undefined,
            });
          }}
        >
          <label className="block text-xs text-muted-foreground" htmlFor={`opp-${message.id}`}>
            Which bid is this reply about? It will be recorded as a reply on that
            opportunity, the same as one we matched automatically.
          </label>
          <select
            id={`opp-${message.id}`}
            className="input mt-1 w-full text-sm"
            value={opportunityId}
            onChange={(e) => setOpportunityId(e.target.value)}
            required
          >
            <option value="">Choose an opportunity</option>
            {opportunities.map((o) => (
              <option key={o.id} value={o.id}>
                {o.title}
              </option>
            ))}
          </select>
          <div className="mt-1 flex items-center gap-2">
            <button type="submit" className="btn-secondary text-xs" disabled={busy || !opportunityId}>
              {busy ? "Placing" : "Place it"}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {open === "dismiss" && (
        <form
          className="mt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send({ action: "dismiss", reason });
          }}
        >
          <label className="block text-xs text-muted-foreground" htmlFor={`why-${message.id}`}>
            Why is this not ours? Dismissing with no reason cannot be told apart from
            a message nobody read.
          </label>
          <input
            id={`why-${message.id}`}
            className="input mt-1 w-full text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Newsletter, not a reply to us"
            required
          />
          <div className="mt-1 flex items-center gap-2">
            <button type="submit" className="btn-secondary text-xs" disabled={busy || !reason.trim()}>
              {busy ? "Saving" : "Dismiss"}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {error && <p role="alert" className="mt-1 text-xs text-risk">{error}</p>}
    </li>
  );
}
