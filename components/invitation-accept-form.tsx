"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The invited person's first screen.
 *
 * Their email is fixed by the invitation and shown read-only rather than as an
 * editable field: the whole invitation, including any discount, is tied to
 * that address, and letting them change it here would either silently ignore
 * what they typed or hand the terms to somebody else.
 */
export function InvitationAcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name: String(fd.get("name") || ""),
          companyName: String(fd.get("companyName") || ""),
          password: String(fd.get("password") || ""),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok) {
        setError(data.error || "Could not set up your account.");
        setPending(false);
        return;
      }
      router.push(data.redirect || "/today");
      router.refresh();
    } catch {
      setError("Network error. Try again.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="invited-email">
          Your email
        </label>
        <input
          id="invited-email"
          className="input mt-1 bg-surface text-muted-foreground"
          value={email}
          readOnly
          disabled
        />
        <p className="mt-1 text-xs text-muted-foreground">
          This invitation is for this address. You will sign in with it.
        </p>
      </div>
      <div>
        <label className="label" htmlFor="name">
          Your name
        </label>
        <input id="name" name="name" required className="input mt-1" autoComplete="name" />
      </div>
      <div>
        <label className="label" htmlFor="companyName">
          Company name
        </label>
        <input
          id="companyName"
          name="companyName"
          required
          className="input mt-1"
          autoComplete="organization"
        />
      </div>
      <div>
        <label className="label" htmlFor="password">
          Choose a password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          className="input mt-1"
          autoComplete="new-password"
        />
        <p className="mt-1 text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      {error && <p className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Setting up your account..." : "Create my account"}
      </button>
    </form>
  );
}
