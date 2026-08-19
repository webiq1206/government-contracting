"use client";

import { useState } from "react";

export function ForgotPasswordForm() {
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  // False only when the site cannot send email at all. Telling someone to check
  // an inbox that will never receive anything is worse than telling them
  // nothing, because they wait instead of looking for another way in.
  const [delivered, setDelivered] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const fd = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(fd.get("email") || "") }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { delivered?: boolean } | null;
    // Only an explicit yes counts. A request that never reached the server, an
    // error page, or any response that does not say so is a link that did not
    // get sent, and saying "check your email" to those is the failure this
    // whole path exists to stop.
    setDelivered(res?.ok === true && body?.delivered === true);
    setDone(true);
    setPending(false);
  }

  if (done && !delivered) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-foreground">No reset link was sent</p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This site cannot send email right now, so no link went out and waiting
          for one will not help. Nothing is wrong with your account. Contact your
          administrator to have the password set directly.
        </p>
      </div>
    );
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
