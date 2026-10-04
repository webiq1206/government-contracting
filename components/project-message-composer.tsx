"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { UnsavedGuard } from "./unsaved-guard";
import { preserveSendRequest } from "@/lib/client/manual-send-request";

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
  const inFlight = useRef(false);
  const storageKey = `project-message:${subId}:${projectId}:${trade}`;
  const safeKey = `${storageKey}:confirmed-nondelivery`;
  useEffect(() => {
    try {
      const requestKey = sessionStorage.getItem(storageKey);
      const confirmed = !!requestKey && sessionStorage.getItem(safeKey) === requestKey;
      setLocked(!!requestKey); setSafe(confirmed);
      if (requestKey) setOutcome(confirmed
        ? "The previous request was held or refused. Prepare a new request explicitly before sending revised text."
        : "An earlier request exists. Check communication history and Gmail Sent before composing another message; its outcome is not established here.");
    } catch { setLocked(true); setOutcome("Enable session storage so this request can be protected against duplicate sends."); }
  }, [storageKey, safeKey]);
  async function send() {
    if (inFlight.current || safe || locked || !ready || !subject.trim() || !message.trim()) return;
    let requestKey: string;
    try { requestKey = preserveSendRequest(sessionStorage, storageKey); }
    catch { setOutcome("Enable session storage so this request can be protected against duplicate sends."); return; }
    inFlight.current = true; setBusy(true); setLocked(true); setOutcome("");
    try {
      const response = await fetch("/api/conversations/compose", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestKey, subcontractorId: subId, opportunityId: projectId, trade, recipient, sender, subject, message }) });
      const data = await response.json();
      if (!response.ok) {
        setOutcome(data.error ?? "The send outcome is uncertain. Review the ledger and Gmail Sent before trying again.");
        if (data.safeToCompose === true && sessionStorage.getItem(storageKey) === requestKey) {
          sessionStorage.setItem(safeKey, requestKey); setSafe(true);
        }
        return;
      }
      setSent(true); setMessage(""); setOutcome("Message accepted by Gmail. Its receipt is in the project history.");
    } catch { setOutcome("The send outcome is uncertain. Review the ledger and Gmail Sent. This request will not be sent twice."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="card space-y-4">
    <UnsavedGuard when={!!message && !sent} message="This message has unsaved changes. Leave without saving?" />
    <p className="break-all text-sm">From: {sender || "No sending identity available"}<br />To: {recipient || "No email on file"}</p>
    <p className="text-sm text-muted-foreground">Starts a new conversation for this project. To answer an existing message, open its conversation in the history below. Your account signature is added when sent.</p>
    {!ready && <p className="text-sm text-review">A verified contact email and connected sending identity are required. Review the contact and integration settings.</p>}
    <div><label htmlFor="project-message-subject" className="block text-sm">Subject</label><input id="project-message-subject" className="input mt-1 w-full" value={subject} maxLength={250} onChange={e => setSubject(e.target.value)} disabled={sent || busy || (locked && !safe)} /></div>
    <div><label htmlFor="project-message-body" className="block text-sm">Message</label><textarea id="project-message-body" className="input mt-1 min-h-48 w-full" value={message} maxLength={20000} onChange={e => setMessage(e.target.value)} disabled={sent || busy || (locked && !safe)} /></div>
    {outcome && <p role="status" className="text-sm">{outcome}</p>}
    {!sent && <button type="button" className="btn-primary" onClick={send} disabled={busy || locked || safe || !ready || !subject.trim() || !message.trim()}>{busy ? "Sending..." : "Send message"}</button>}
    {safe && <button type="button" className="btn-secondary" onClick={() => {
      if (inFlight.current) return;
      try {
        const requestKey = sessionStorage.getItem(storageKey);
        if (!requestKey || sessionStorage.getItem(safeKey) !== requestKey) { setSafe(false); setLocked(true); return; }
        sessionStorage.removeItem(safeKey); sessionStorage.removeItem(storageKey);
      } catch { return; }
      setSafe(false); setLocked(false); setOutcome("Review your message before sending a new request. The previous request was not accepted.");
    }}>Prepare a new request after confirmed hold or refusal</button>}
    <Link className="block text-sm text-accent" href={`/communications/history?sub=${subId}&project=${projectId}`}>View project communication history</Link>
  </div>;
}
