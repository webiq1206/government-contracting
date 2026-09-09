"use client";

import { useRef, useState } from "react";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const fd = new FormData(e.currentTarget);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: String(fd.get("email") || "") }),
      });
      const body = await res.json().catch(() => null) as { delivered?: boolean } | null;
      if (res.ok && body?.delivered === true) setDone(true);
      else if (res.ok && body?.delivered === false) setError("A reset link was not sent. Email delivery may be unavailable or temporarily limited. Wait a few minutes and try again, or ask your account administrator for help.");
      else setError("We could not confirm whether a reset link was sent. Check your inbox and spam folder before trying again.");
    } catch {
      setError("We could not confirm whether a reset link was sent. Check your inbox and spam folder before trying again.");
    } finally {
      window.clearTimeout(timer);
      submitting.current = false;
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">Check your email</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          If that email is on file, a reset link is on its way. Open the link to
          choose a new password, then sign in. Check spam if nothing arrives within
          a few minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="input mt-1"
          autoComplete="email"
        />
      </div>
      {error && <p role="alert" className="text-sm text-risk">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending..." : error ? "Try again" : "Send reset link"}
      </button>
    </form>
  );
}
