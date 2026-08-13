"use client";

/**
 * Sending-domain setup. The customer's whole job is: pick a domain, publish
 * the DNS records we print, press Check. No OAuth app, no Google verification,
 * no mailbox password. Until they finish, outreach still sends on our shared
 * domain, so this card is an upgrade path rather than a setup wall.
 */

import { useEffect, useState } from "react";

interface DnsRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
  ttl?: string;
}

interface Sender {
  from: string;
  replyTo: string;
  verified: boolean;
  domain: string;
}

interface DomainState {
  domain: string;
  fromLocal: string;
  fromName: string | null;
  replyTo: string | null;
  status: string;
  dnsRecords: DnsRecord[];
  lastError: string | null;
  verifiedAt: string | null;
}

export function SendingDomainCard() {
  const [sender, setSender] = useState<Sender | null>(null);
  const [state, setState] = useState<DomainState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const [domain, setDomain] = useState("");
  const [fromLocal, setFromLocal] = useState("bids");
  const [fromName, setFromName] = useState("");
  const [replyTo, setReplyTo] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/settings/sending-domain");
      if (!res.ok) return;
      const data = await res.json();
      setSender(data.sender ?? null);
      setState(data.domain ?? null);
      if (data.domain) {
        setDomain(data.domain.domain ?? "");
        setFromLocal(data.domain.fromLocal ?? "bids");
        setFromName(data.domain.fromName ?? "");
        setReplyTo(data.domain.replyTo ?? "");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy("save");
    setMessage(null);
    try {
      const res = await fetch("/api/settings/sending-domain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, fromLocal, fromName, replyTo }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: data.error ?? "Could not save that." });
        return;
      }
      setMessage({
        ok: true,
        text:
          data.status === "verified"
            ? "Saved and verified."
            : "Saved. Add the records below at your domain host, then press Check DNS.",
      });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function check() {
    setBusy("check");
    setMessage(null);
    try {
      const res = await fetch("/api/settings/sending-domain/verify", { method: "POST" });
      const data = await res.json();
      setMessage({
        ok: res.ok && data.status === "verified",
        text: data.message ?? data.error ?? "Could not check right now.",
      });
      await load();
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <p className="text-sm text-slate-500">Loading your sending address…</p>
      </div>
    );
  }

  const verified = sender?.verified ?? false;

  return (
    <div className="card flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-foreground">Your sending address</p>
          <p className="mt-0.5 text-sm text-slate-600">
            The address subcontractors see when we email them for you.
          </p>
        </div>
        <span
          className={`badge shrink-0 ${
            verified ? "bg-pursue/15 text-pursue" : "bg-review/15 text-review"
          }`}
        >
          {verified ? "Your own domain" : "Shared address"}
        </span>
      </div>

      <div className="rounded-md border border-border bg-muted/40 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500">Sending right now as</p>
        <p className="num mt-1 break-all text-sm font-medium text-foreground">{sender?.from}</p>
        <p className="mt-1 text-xs text-slate-600">
          Replies go to <span className="num">{sender?.replyTo}</span>
        </p>
      </div>

      {!verified && (
        <p className="text-sm text-slate-700">
          Emails are going out on our shared address, which works today. Adding your own
          domain makes them come from you and helps them land in the inbox instead of spam.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="sd-domain">
            Your sending domain
          </label>
          <input
            id="sd-domain"
            className="input mt-1"
            placeholder="mail.yourcompany.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            A subdomain is best. You need to be able to edit its DNS.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="sd-reply">
            Replies go to
          </label>
          <input
            id="sd-reply"
            className="input mt-1"
            placeholder="you@yourcompany.com"
            value={replyTo}
            onChange={(e) => setReplyTo(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">An inbox you actually read.</p>
        </div>
        <div>
          <label className="label" htmlFor="sd-local">
            Send from
          </label>
          <input
            id="sd-local"
            className="input mt-1"
            placeholder="bids"
            value={fromLocal}
            onChange={(e) => setFromLocal(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">
            The part before the @, so {fromLocal || "bids"}@{domain || "yourcompany.com"}
          </p>
        </div>
        <div>
          <label className="label" htmlFor="sd-name">
            Show your name as
          </label>
          <input
            id="sd-name"
            className="input mt-1"
            placeholder="Your Company"
            value={fromName}
            onChange={(e) => setFromName(e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">What subs see in their inbox list.</p>
        </div>
      </div>

      {state?.dnsRecords?.length ? (
        <div>
          <p className="text-sm font-medium text-foreground">
            Add these records at your domain host
          </p>
          <p className="mt-0.5 text-xs text-slate-600">
            Copy each row into your DNS settings, then press Check DNS. This usually takes a
            few minutes and can take up to an hour.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[38rem] text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1 pr-3 font-medium">Type</th>
                  <th className="py-1 pr-3 font-medium">Name</th>
                  <th className="py-1 pr-3 font-medium">Value</th>
                  <th className="py-1 font-medium">Priority</th>
                </tr>
              </thead>
              <tbody className="align-top">
                {state.dnsRecords.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="num py-1.5 pr-3">{r.type}</td>
                    <td className="num py-1.5 pr-3 break-all">{r.name}</td>
                    <td className="num py-1.5 pr-3 break-all">{r.value}</td>
                    <td className="num py-1.5">{r.priority ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {state?.lastError && <p className="text-xs text-risk">{state.lastError}</p>}
      {message && (
        <p className={`text-sm ${message.ok ? "text-pursue" : "text-risk"}`}>{message.text}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 border-t border-border pt-3">
        <button className="btn-primary text-xs" onClick={save} disabled={busy != null}>
          {busy === "save" ? "Saving…" : "Save"}
        </button>
        {state?.domain && state.status !== "verified" && (
          <button className="btn-ghost text-xs" onClick={check} disabled={busy != null}>
            {busy === "check" ? "Checking…" : "Check DNS"}
          </button>
        )}
      </div>
    </div>
  );
}
