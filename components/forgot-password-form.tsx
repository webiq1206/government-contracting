"use client";

import { useState } from "react";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(fd.get("email") || "") }),
    }).catch(() => null);
    setDone(true);
    setPending(false);
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
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}
