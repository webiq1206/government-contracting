"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UnsavedGuard } from "./unsaved-guard";
import { preserveSendRequest } from "@/lib/client/manual-send-request";
type Intent = { requestKey: string; subcontractorId: string; opportunityId: string; trade: string; recipient: string; sender: string; subject: string; message: string };

export function ProjectMessageComposer({ subId, projectId, trade, recipient, sender, ready }: {
  subId: string; projectId: string; trade: string; recipient: string; sender: string; ready: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [sent, setSent] = useState(false);
  const [safe, setSafe] = useState(false);
  const [locked, setLocked] = useState(false);
  const [canRetry, setCanRetry] = useState(false);
  const inFlight = useRef(false);
  const intent = useRef<Intent | null>(null);
  const storageKey = `project-message:${subId}:${projectId}:${trade}`;
  const safeKey = `${storageKey}:confirmed-nondelivery`;
  const acceptedKey = `${storageKey}:accepted`;
  const intentKey = `${storageKey}:intent`;
  useEffect(() => {
    try {
      const requestKey = sessionStorage.getItem(storageKey);
      const confirmed = !!requestKey && sessionStorage.getItem(safeKey) === requestKey;
      const accepted = !!requestKey && sessionStorage.getItem(acceptedKey) === requestKey;
      const saved = JSON.parse(sessionStorage.getItem(intentKey) || "null") as Intent | null;
      intent.current = saved?.requestKey === requestKey && saved?.subcontractorId === subId && saved?.opportunityId === projectId && saved?.trade === trade ? saved : null;
      setLocked(!!requestKey); setSafe(confirmed); setSent(accepted); setCanRetry(!!intent.current);
      if (intent.current) { setSubject(intent.current.subject); setMessage(intent.current.message); }
      if (requestKey) setOutcome(accepted ? "Message accepted by Gmail. Start another message only if you intend a distinct new conversation."
        : confirmed ? "The previous request was held or refused. Prepare a new request explicitly before sending revised text."
        : "An earlier request exists. Check communication history and Gmail Sent. Retrying uses the original message and request identity.");
    } catch { setLocked(true); setOutcome("Session storage is unavailable. Check communication history before composing another message."); }
  }, [storageKey, safeKey, acceptedKey, intentKey, subId, projectId, trade]);
  async function send() {
    if (inFlight.current || safe || sent || !ready || (locked && !intent.current) || !subject.trim() || !message.trim()) return;
    let payload: Intent;
    try {
      const requestKey = preserveSendRequest(sessionStorage, storageKey);
      payload = intent.current ?? { requestKey, subcontractorId: subId, opportunityId: projectId, trade, recipient, sender, subject, message };
      if (payload.requestKey !== requestKey) throw new Error("Request identity changed");
      sessionStorage.setItem(intentKey, JSON.stringify(payload)); intent.current = payload; setCanRetry(true);
    } catch { setOutcome("Enable session storage so this request can be protected against duplicate sends."); return; }
    inFlight.current = true; setBusy(true); setLocked(true); setOutcome("");
    try {
      const response = await fetch("/api/conversations/compose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await response.json();
      if (!response.ok) {
        setOutcome(data.error ?? "The send outcome is uncertain. Review the ledger and Gmail Sent before trying again.");
        if (data.safeToCompose === true && sessionStorage.getItem(storageKey) === payload.requestKey) {
          sessionStorage.setItem(safeKey, payload.requestKey); setSafe(true);
        }
        return;
      }
      sessionStorage.setItem(acceptedKey, payload.requestKey);
      setSent(true); setOutcome("Message accepted by Gmail. Its receipt is in the project history.");
    } catch { setOutcome("The send outcome is uncertain. Review the ledger and Gmail Sent. Retrying preserves the original message and request identity."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function prepareNew() {
    if (inFlight.current) return;
    try {
      const requestKey = sessionStorage.getItem(storageKey);
      const accepted = !!requestKey && sessionStorage.getItem(acceptedKey) === requestKey;
      if (!requestKey || (!accepted && sessionStorage.getItem(safeKey) !== requestKey)) { setSafe(false); setLocked(true); return; }
      sessionStorage.removeItem(safeKey); sessionStorage.removeItem(acceptedKey); sessionStorage.removeItem(intentKey); sessionStorage.removeItem(storageKey);
      if (accepted) { setSubject(""); setMessage(""); }
      intent.current = null; setCanRetry(false); setSafe(false); setSent(false); setLocked(false);
      setOutcome(accepted ? "Review a distinct new message before sending. The previous message was accepted by Gmail."
        : "Review your message before sending a new request. The previous request was not accepted.");
    } catch { /* Keep the existing identity if storage cannot be updated. */ }
  }
  return <div className="card space-y-4">
    <UnsavedGuard when={!!message && !sent} message="This message has unsaved changes. Leave without saving?" />
    <p className="break-all text-sm">From: {(locked ? intent.current?.sender : sender) || sender || "No sending identity available"}<br />To: {(locked ? intent.current?.recipient : recipient) || recipient || "No email on file"}</p>
    {locked && intent.current && (intent.current.sender !== sender || intent.current.recipient !== recipient) && <p className="text-sm text-review">Current sender or recipient settings differ. The original request keeps the addresses shown above; review its outcome before preparing a replacement.</p>}
    <p className="text-sm text-muted-foreground">Starts a new conversation for this project. To answer an existing message, open its conversation in the history below. Your account signature is added when sent. A pending message is retained in this tab's session storage for an unchanged retry.</p>
    {!ready && <p className="text-sm text-review">A verified contact email and connected sending identity are required. Review the contact and integration settings.</p>}
    <div><label htmlFor="project-message-subject" className="block text-sm">Subject</label><input id="project-message-subject" className="input mt-1 w-full" value={subject} maxLength={250} onChange={e => setSubject(e.target.value)} disabled={sent || busy || (locked && !safe)} /></div>
    <div><label htmlFor="project-message-body" className="block text-sm">Message</label><textarea id="project-message-body" className="input mt-1 min-h-48 w-full" value={message} maxLength={20000} onChange={e => setMessage(e.target.value)} disabled={sent || busy || (locked && !safe)} /></div>
    {outcome && <p role="status" className="text-sm">{outcome}</p>}
    {!sent && <button type="button" className="btn-primary" onClick={send} disabled={busy || (locked && !canRetry) || safe || !ready || !subject.trim() || !message.trim()}>{busy ? "Sending..." : locked ? "Retry original request" : "Send message"}</button>}
    {safe && <button type="button" className="btn-secondary" onClick={prepareNew}>Prepare a new request after confirmed hold or refusal</button>}
    {sent && <button type="button" className="btn-secondary" onClick={prepareNew}>Start another message</button>}
    <Link className="block text-sm text-accent" href={`/communications/history?sub=${subId}&project=${projectId}`}>View project communication history</Link>
  </div>;
}
