"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionView } from "@/lib/domain/session-device";

/**
 * The three things a person can change about their own account.
 *
 * One client component rather than three, because they share the same
 * save-state shape and the page would otherwise carry three copies of it.
 */

function Message({ tone, children }: { tone: "ok" | "bad"; children: React.ReactNode }) {
  return (
    <p
      role="status"
      className={`mt-2 text-sm leading-relaxed ${tone === "ok" ? "text-pursue" : "text-risk"}`}
    >
      {children}
    </p>
  );
}

export function DisplayNameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/name", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setMsg({ tone: "bad", text: data.error ?? "Could not save that." });
        return;
      }
      setMsg({ tone: "ok", text: "Saved." });
      // The name appears in the sidebar and on anything you sign, so the rest
      // of the shell has to catch up rather than show the old one until a
      // reload.
      router.refresh();
    } catch {
      setMsg({ tone: "bad", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <label htmlFor="account-name" className="label block">
        Your name
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id="account-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          autoComplete="name"
          className="input min-w-0 flex-1 text-sm"
        />
        <button type="submit" className="btn-primary text-sm" disabled={busy || name === initial}>
          {busy ? "Saving" : "Save"}
        </button>
      </div>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </form>
  );
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const router = useRouter();

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        otherSessionsEnded?: number;
      };
      if (!res.ok) {
        setMsg({ tone: "bad", text: data.error ?? "Could not change your password." });
        return;
      }
      const ended = data.otherSessionsEnded ?? 0;
      setMsg({
        tone: "ok",
        text:
          ended > 0
            ? `Password changed. ${ended} other device${ended === 1 ? " was" : "s were"} signed out.`
            : "Password changed. No other device was signed in.",
      });
      setCurrent("");
      setNext("");
      router.refresh();
    } catch {
      setMsg({ tone: "bad", text: "Could not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="pw-current" className="label block">
          Current password
        </label>
        <input
          id="pw-current"
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoComplete="current-password"
          className="input w-full max-w-sm text-sm"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor="pw-next" className="label block">
          New password
        </label>
        <input
          id="pw-next"
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          autoComplete="new-password"
          aria-describedby="pw-rule"
          className="input w-full max-w-sm text-sm"
        />
        <p id="pw-rule" className="text-sm text-muted-foreground">
          At least 10 characters. Changing it signs out every other device, and keeps this
          one.
        </p>
      </div>
      <button
        type="submit"
        className="btn-primary text-sm"
        disabled={busy || !current || next.length < 10}
      >
        {busy ? "Changing" : "Change password"}
      </button>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </form>
  );
}

export function SessionList({ sessions, summary }: { sessions: SessionView[]; summary: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const others = sessions.filter((s) => !s.current).length;

  async function post(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    setMsg(null);
    try {
      const res = await fetch("/api/account/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ended?: number };
      if (!res.ok) {
        setMsg({ tone: "bad", text: data.error ?? "Could not end that session." });
        return;
      }
      const ended = data.ended ?? 0;
      setMsg({
        tone: "ok",
        text:
          key === "others"
            ? `${ended} device${ended === 1 ? "" : "s"} signed out.`
            : "That device is signed out.",
      });
      router.refresh();
    } catch {
      setMsg({ tone: "bad", text: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
        {others > 0 && (
          <button
            type="button"
            onClick={() => post({ scope: "others" }, "others")}
            disabled={busy !== null}
            className="btn-ghost text-xs"
          >
            {busy === "others" ? "Signing out" : "Sign out every other device"}
          </button>
        )}
      </div>
      <ul className="space-y-1.5">
        {sessions.map((s) => (
          <li key={s.id} className="panel-inset px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{s.device}</span>
              {s.current && <span className="badge bg-pursue/10 text-pursue">this device</span>}
              {s.support && <span className="badge bg-review/15 text-review">support session</span>}
            </div>
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              Last used {s.lastSeen}. Signed in {s.signedIn}. Expires {s.expires}.
            </p>
            {s.support && (
              <p className="mt-0.5 text-sm leading-relaxed text-review">{s.support}</p>
            )}
            {!s.current && (
              <button
                type="button"
                onClick={() => post({ sessionId: s.id }, s.id)}
                disabled={busy !== null}
                className="tap mt-1 inline-flex min-h-11 items-center text-xs font-medium text-accent hover:underline md:min-h-0"
              >
                {busy === s.id ? "Signing out" : "Sign out this device"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {msg && <Message tone={msg.tone}>{msg.text}</Message>}
    </div>
  );
}
